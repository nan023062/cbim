import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {RunSummary} from '../src/logic/execution/rules/types';
import {knowledgeContractProvider,knowledgeContractFixture as data,type KnowledgeContractMode} from './knowledge-contract-provider';
import {seedKnowledgeContract,knowledgeContractRecords,knowledgeContractLogBytes} from './knowledge-contract-fixture';

it.each(['complete','stop','malformed-after-commit'] as KnowledgeContractMode[])('real Pi knowledge output contracts preserve diagnostics, one-time commit and cancellation (%s)',async mode=>{
  const f=await fixture(),provider=await knowledgeContractProvider(mode);let app=f.app;
  try{
    const {entry,snapshot}=await seedKnowledgeContract(app,f.a,provider),workspace=app.workspace(entry.id),realCommit=workspace.commit.bind(workspace);
    // Explicit test-only fault after a real committed transaction. Never replace the underlying operation or expose a product test hook.
    const commits=vi.spyOn(workspace,'commit').mockImplementation(async input=>{const result=await realCommit(input);return mode==='malformed-after-commit'?{...result,changed:'PRIVATE_INVALID_OUTPUT_SENTINEL'} as unknown as typeof result:result});
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'ask',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>knowledgeContractRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect(await app.dispatch('loop.approvals',{id:entry.id,taskId:started.taskId})).toHaveLength(1)},{timeout:30000,interval:30});
    const approvals=await app.dispatch('loop.approvals',{id:entry.id,taskId:started.taskId});expect(approvals[0].name).toBe('cbim_knowledge_commit');expect(commits).not.toHaveBeenCalled();expect((await workspace.snapshot()).revision).toBe(snapshot.revision);expect(provider.state.invalidPreview.validation.structural).toBe(false);expect(provider.state.notFound).toEqual({state:'not_found'});
    if(mode==='stop')await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});else await app.dispatch('loop.approve',{id:entry.id,taskId:started.taskId,approvalId:approvals[0].id,allow:true});
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const saved=await records(),finished=await graph(),summary=await app.dispatch('loop.inspect',{id:entry.id,taskId:started.taskId,runId:started.runId}) as RunSummary,after=await workspace.snapshot(),receipt=summary.toolReceipts?.find(value=>value.toolCallId==='contract-commit');
    expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':mode==='stop'?'cancelled':'failed');expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(summary.unresolvedTools).toEqual([]);expect(await app.dispatch('loop.approvals',{id:entry.id,taskId:started.taskId})).toEqual([]);
    for(const id of ['contract-identity','contract-catalog','contract-describe','contract-snapshot','contract-invalid-preview','contract-not-found'])expect(summary.toolReceipts?.find(value=>value.toolCallId===id),id).toMatchObject({outcome:'succeeded'});
    if(mode==='stop'){expect(commits).not.toHaveBeenCalled();expect(after.revision).toBe(snapshot.revision);expect(receipt?.outcome).not.toBe('succeeded');expect(provider.requests).toHaveLength(8)}
    else{
      expect(commits).toHaveBeenCalledTimes(1);expect(after.revision).not.toBe(snapshot.revision);expect(after.files.find(value=>value.path==='.cbim/README.md')!.text.split(data.marker)).toHaveLength(2);expect(after.files.find(value=>value.path==='.cbim/team/people.json')).toEqual(snapshot.files.find(value=>value.path==='.cbim/team/people.json'));expect(provider.requests).toHaveLength(11);
      expect(receipt).toMatchObject({outcome:mode==='complete'?'succeeded':'failed',effects:['knowledge-write'],scope:{kind:'knowledge',workspaceId:entry.id}});
      if(mode==='malformed-after-commit'){
        const finishedCall=summary.events.filter(value=>value.type==='tool.finished'&&value.data.id==='contract-commit');expect(finishedCall).toHaveLength(1);expect(finishedCall[0].data).toMatchObject({isError:true,result:{content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]}});expect(JSON.stringify(finishedCall)).not.toContain('PRIVATE_INVALID_OUTPUT_SENTINEL');
        const native=(await fs.readFile(summary.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(native.find(value=>value.message?.toolCallId==='contract-commit')?.message).toMatchObject({isError:true,content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]});
        const transactions=await fs.readdir(path.join(f.user,entry.id,'transactions'));expect(transactions.filter(value=>value===provider.requestId+'.json')).toHaveLength(1);
      }
    }
    const bytes=await knowledgeContractLogBytes(f.user,entry.id),requests=provider.requests.length;vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await knowledgeContractLogBytes(f.user,entry.id)).toEqual(bytes);expect((await app.workspace(entry.id).snapshot()).revision).toBe(after.revision);expect(provider.requests).toHaveLength(requests);expect(provider.errors).toEqual([]);
  }finally{vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);
