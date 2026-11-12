import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {RunSummary} from '../src/backend/core/execution/types';
import type {AgentHistoryPage,AgentHistorySession,AgentHistoryEventsRead} from '../src/backend/core/team/session-history';
import {repositoryToolsProvider,repositoryToolsFixture as data,type RepositoryToolsMode} from './repository-tools-provider';
import {seedRepositoryTools,repositoryToolsRecords,repositoryToolsLogBytes} from './repository-tools-fixture';

it.each(['complete','stop','revoked','generation','ungranted'] as RepositoryToolsMode[])('real Pi main repository tools bind actual HTTP receipts and reject invalidated results (%s)',async mode=>{
  const f=await fixture(),provider=await repositoryToolsProvider(mode);let app=f.app,release=()=>{},entered=false;const actualFetch=globalThis.fetch,reads:string[]=[];
  try{
    const seeded=await seedRepositoryTools(app,f.temp,provider,mode!=='ungranted'),workspace=app.workspace(seeded.entry.id),snapshot=await workspace.snapshot(),beforeRepository=await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8');
    const gate=new Promise<void>(resolve=>{release=resolve});
    // Explicit scheduling fault window after a real HTTP response. No fake resource result, production hook or replacement server.
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
      const url=String(input);if(!url.endsWith('/v1/resources'))return actualFetch(input,options);reads.push(url);const response=await actualFetch(input,options);
      if(reads.length===2&&['stop','revoked','generation'].includes(mode)){
        entered=true;const signal=options?.signal;
        await new Promise<void>((resolve,reject)=>{const cancel=()=>{void response.body?.cancel().catch(()=>{});reject(new DOMException('The operation was aborted','AbortError'))};if(signal?.aborted){cancel();return}signal?.addEventListener('abort',cancel,{once:true});gate.then(()=>{signal?.removeEventListener('abort',cancel);resolve()})});
      }
      return response;
    });
    const started=await app.dispatch('loop.chat',{id:seeded.entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),identity={workspaceId:seeded.entry.id,rootSessionId:started.taskId},records=()=>repositoryToolsRecords(f.user,seeded.entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    if(['stop','revoked','generation'].includes(mode)){
      await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(entered).toBe(true)},{timeout:30000,interval:30});expect(reads).toHaveLength(2);
      if(mode==='stop')await app.dispatch('loop.stop',{id:seeded.entry.id,taskId:started.taskId});
      else if(mode==='revoked')await app.dispatch('resources.connection.revoke',{...seeded.identity,connectorId:data.connectorId,expectedGrantRevision:seeded.grant!.grant.revision,commandId:randomUUID()});
      else{await app.dispatch('resources.stopSharing');await app.dispatch('resources.share',{lan:false,port:0})}
      release();
    }
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const saved=await records(),finished=await graph(),summary=await app.dispatch('loop.inspect',{id:seeded.entry.id,taskId:started.taskId,runId:started.runId}) as RunSummary;
    expect(saved.scopes[0].outcome).toBe(mode==='stop'?'cancelled':'completed');expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(summary.unresolvedTools).toEqual([]);expect(await app.dispatch('loop.approvals',{id:seeded.entry.id,taskId:started.taskId})).toEqual([]);
    const receipts=summary.toolReceipts?.filter(value=>value.toolName.startsWith('cbim_repository_'))??[];
    if(mode==='ungranted'){expect(receipts).toEqual([]);expect(reads).toEqual([]);expect(provider.requests).toHaveLength(1)}
    else{
      expect(receipts).toHaveLength(2);const listed=receipts.find(value=>value.toolCallId==='repository-list')!,got=receipts.find(value=>value.toolCallId==='repository-get')!;
      expect(listed).toMatchObject({outcome:'succeeded',scope:{kind:'repository',workspaceId:seeded.entry.id,connectorId:data.connectorId,repositoryId:seeded.library.repositoryId,operation:'list'}});expect(listed.scope.kind).toBe('repository');
      expect(got.scope).toEqual({...listed.scope,operation:'get'});expect(reads).toHaveLength(2);expect(provider.requests).toHaveLength(mode==='stop'?2:3);
      if(mode==='stop')expect(['failed','denied','unknown']).toContain(got.outcome);else expect(got.outcome).toBe(mode==='complete'?'succeeded':'failed');
      if(mode==='complete'){expect(provider.state.get).toMatchObject({scope:got.scope,revision:seeded.library.revision,resource:{id:seeded.library.items[0].id},content:{text:data.content,offset:0,totalCharacters:Array.from(data.content).length,contentHash:createHash('sha256').update(data.content).digest('hex'),complete:true},readOnly:true})}
      else expect(JSON.stringify(summary.events.filter(event=>event.type==='tool.finished'&&event.data.id==='repository-get'))).not.toContain('REPOSITORY_HTTP_CONTENT_17b2_42c1');
      expect(JSON.stringify(receipts)).not.toMatch(/Bearer|"token"|"url"|"location"/);expect(receipts.every(value=>value.scope.kind!=='workspace'&&value.scope.kind!=='knowledge')).toBe(true);
    }
    const source=summary.events.find(event=>event.type==='run.started')!;expect(source.data.conversationBinding).toMatchObject({agentId:'cbim:main',rootSessionId:started.taskId,agentInstanceId:finished.root.agent.agentInstanceId});expect(saved.members).toHaveLength(1);expect(saved.members[0].agentId).toBe('cbim:main');
    const sessions=await app.dispatch('agentHistory.sessions',{workspaceId:seeded.entry.id,agentId:'cbim:main'}) as AgentHistoryPage<AgentHistorySession>;expect(sessions.items).toHaveLength(1);expect(sessions.items[0].rootSessionId).toBe(started.taskId);
    const history=await app.dispatch('agentHistory.events',{workspaceId:seeded.entry.id,agentId:'cbim:main',sessionId:sessions.items[0].sessionId,taskId:started.taskId,runId:started.runId,limit:500}) as AgentHistoryEventsRead;
    if(mode!=='ungranted')expect(JSON.stringify(history)).toContain('"kind":"repository"');expect(JSON.stringify(history)).not.toContain('REPOSITORY_HTTP_CONTENT_17b2_42c1');expect(JSON.stringify(history)).not.toMatch(/Bearer|"token"|sessionFile/);
    expect((await workspace.snapshot()).files).toEqual(snapshot.files);expect(await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8')).toBe(beforeRepository);
    const bytes=await repositoryToolsLogBytes(f.user,seeded.entry.id),requestCount=provider.requests.length,readCount=reads.length;await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect((await app.dispatch('resources.status')).sharing).toBeUndefined();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await repositoryToolsLogBytes(f.user,seeded.entry.id)).toEqual(bytes);expect(provider.requests).toHaveLength(requestCount);expect(reads).toHaveLength(readCount);expect(provider.errors).toEqual([]);
  }finally{release();vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);
