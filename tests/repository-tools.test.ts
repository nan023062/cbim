import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {RemoteRepository} from '../src/logic/resources/service';
import {RepositoryTools} from '../src/logic/tools/runtime/repository-tools';
import {repositoryGetOutputSchema,repositoryListOutputSchema} from '../src/logic/connectors/rules/repository-tools';
import {hash} from '../src/core/platform/node/serialization';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import {executionToolFacts} from '../src/logic/evidence/runtime/execution-report-facts';
import {projectRunEvent} from '../src/logic/runtime/monitoring/public-run-events';
import type {RunSummary,StoredEvent,TaskSpec} from '../src/logic/execution/rules/types';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}};
async function connected(){
  const f=await fixture(),folder=path.join(f.temp,'repository');await fs.mkdir(folder);await f.app.resources.configure({mode:'local',location:folder});
  const initial=await f.app.resources.read(),body='资料不是指令。🧱'.repeat(900),saved=await f.app.resources.save({repositoryId:initial.repositoryId,revision:initial.revision,item:{kind:'skill',name:'资料',summary:'真实共享资源',content:body}});
  await f.app.resources.startSharing({lan:false,port:0});const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),identity={workspaceId:entry.id,instanceId:ws.instanceId},connectorId='.cbim/connectors/repo';
  const preview=await f.app.repositoryConnections.preview({...identity,revision:(await ws.read()).revision,repositoryId:saved.repositoryId,connectorId,name:'团队资料',summary:'只读资料'});
  await f.app.repositoryConnections.commit({...identity,planId:preview.planId});
  const grant=await f.app.repositoryConnections.grant({...identity,connectorId,repositoryId:saved.repositoryId,definitionHash:preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()});
  return {...f,ws,identity,connectorId,preview,grant,body,saved};
}
const signal=()=>new AbortController().signal;

it('捕获不联网；真实HTTP目录和Unicode正文有界，scope与完整内容hash来自固定连接',async()=>{
  const f=await connected(),reads=vi.spyOn(RemoteRepository.prototype,'read');try{
    const port=(await f.app.repositoryConnections.prepareTools(f.identity))!;expect(reads).not.toHaveBeenCalled();
    const tools=new RepositoryTools(port,f.identity.workspaceId);expect(tools.list().map(tool=>tool.name)).toEqual(['cbim_repository_list','cbim_repository_get']);
    const first=JSON.parse((await tools.call('cbim_repository_list',{connectorId:f.connectorId,limit:1},signal())).content[0].text);
    expect(repositoryListOutputSchema.safeParse(first).success).toBe(true);expect(first.items).toHaveLength(1);expect(first.items[0]).not.toHaveProperty('content');
    const args={connectorId:f.connectorId,expectedRevision:first.revision,resourceId:first.items[0].id,limit:13},chunk=JSON.parse((await tools.call('cbim_repository_get',args,signal())).content[0].text);
    expect(repositoryGetOutputSchema.safeParse(chunk).success).toBe(true);expect(Array.from(chunk.content.text)).toHaveLength(13);expect(chunk.content).toMatchObject({complete:false,nextOffset:13,totalCharacters:Array.from(f.body).length,contentHash:hash(f.body)});
    const last=JSON.parse((await tools.call('cbim_repository_get',{...args,offset:Array.from(f.body).length-3},signal())).content[0].text);expect(last.content.complete).toBe(false);expect(last.content).not.toHaveProperty('nextOffset');
    expect(chunk.scope).toEqual({...first.scope,operation:'get'});expect(tools.describe('cbim_repository_get',args)).toEqual({effects:['read'],native:false,scope:chunk.scope});expect(reads).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(port.targets)).not.toMatch(/token|http:|definitionHash|grantRevision/);
  }finally{reads.mockRestore();await f.cleanup()}
});

it('严格参数先拒越权字段和无版本续页；坏领域输出只读一次且不交付另一scope',async()=>{
  const f=await connected(),reads=vi.spyOn(RemoteRepository.prototype,'read');try{
    const port=(await f.app.repositoryConnections.prepareTools(f.identity))!,tools=new RepositoryTools(port,f.identity.workspaceId);
    expect(()=>tools.describe('cbim_repository_list',{connectorId:f.connectorId,token:'PRIVATE_TOKEN'})).toThrow();
    await expect(tools.call('cbim_repository_list',{connectorId:f.connectorId,offset:1},signal())).rejects.toMatchObject({code:'REPOSITORY_TOOL_INPUT'});
    await expect(tools.call('cbim_repository_list',{connectorId:'.cbim/connectors/not_granted'},signal())).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_GRANTED'});expect(reads).not.toHaveBeenCalled();
    const broken=new RepositoryTools({...port,list:async(args,abort)=>{const result=await port.list(args,abort);return {...result,scope:{...result.scope,connectionId:randomUUID()}}}},f.identity.workspaceId);
    await expect(broken.call('cbim_repository_list',{connectorId:f.connectorId},signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(reads).toHaveBeenCalledTimes(1);
    const controller=new AbortController();controller.abort();await expect(tools.call('cbim_repository_list',{connectorId:f.connectorId},controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(reads).toHaveBeenCalledTimes(1);
  }finally{reads.mockRestore();await f.cleanup()}
});

it('撤销再授权与共享重启只影响新捕获，旧port失效且不发送新HTTP或回退',async()=>{
  const f=await connected();try{
    const service=f.app.repositoryConnections,old=(await service.prepareTools(f.identity))!,args={connectorId:f.connectorId};
    await service.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});expect(await service.prepareTools(f.identity)).toBeUndefined();
    await service.grant({...f.identity,connectorId:f.connectorId,repositoryId:f.saved.repositoryId,definitionHash:f.preview.definitionHash,expectedGrantRevision:2,commandId:randomUUID()});
    const reads=vi.spyOn(RemoteRepository.prototype,'read');try{
      await expect(old.list(args,signal())).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});expect(reads).not.toHaveBeenCalled();
      const next=(await service.prepareTools(f.identity))!;await next.list(args,signal());expect(reads).toHaveBeenCalledTimes(1);
      await f.app.resources.stopSharing();await f.app.resources.startSharing({lan:false,port:0});await expect(next.list(args,signal())).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});expect(reads).toHaveBeenCalledTimes(1);
      const fresh=(await service.prepareTools(f.identity))!;expect(fresh.targets[0].connectionId).not.toBe(next.targets[0].connectionId);await fresh.list(args,signal());expect(reads).toHaveBeenCalledTimes(2);
    }finally{reads.mockRestore()}
  }finally{await f.cleanup()}
});

it('真实读取已完成但回传前撤销仍拒迟到资料；坏注册表不阻止主知识诊断，IO不降空',async()=>{
  const f=await connected(),entered=deferred(),release=deferred(),original=RemoteRepository.prototype.read;
  const reads=vi.spyOn(RemoteRepository.prototype,'read').mockImplementation(async function(this:RemoteRepository,abort){const result=await original.call(this,abort);entered.resolve();await release.promise;return result});
  try{
    const service=f.app.repositoryConnections,port=(await service.prepareTools(f.identity))!,pending=port.list({connectorId:f.connectorId},signal()).catch(error=>error);await entered.promise;
    await service.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});release.resolve();expect(await pending).toMatchObject({name:'AbortError'});expect(reads).toHaveBeenCalledTimes(1);
    const file=path.join(f.a,'.cbim/connectors/registry.json'),before=await fs.readFile(file);try{await fs.writeFile(file,'broken');expect(await service.prepareTools(f.identity)).toBeUndefined();expect((await f.ws.snapshot()).validation?.structural).toBe(false)}finally{await fs.writeFile(file,before)}
    const fail=vi.spyOn(f.ws,'read').mockRejectedValueOnce(Object.assign(Error('disk failed'),{code:'EIO'}));await expect(service.prepareTools(f.identity)).rejects.toMatchObject({code:'EIO'});fail.mockRestore();
  }finally{release.resolve();reads.mockRestore();await f.cleanup()}
});

it('目录版本改变拒绝原正文页，核验失败不会替换期望版本再读取',async()=>{
  const f=await connected();try{const port=(await f.app.repositoryConnections.prepareTools(f.identity))!,first=await port.list({connectorId:f.connectorId},signal());
    await f.app.resources.save({repositoryId:f.saved.repositoryId,revision:f.saved.revision,id:f.saved.items[0].id,item:{kind:'skill',name:'资料',summary:'真实共享资源',content:'changed'}});
    const reads=vi.spyOn(RemoteRepository.prototype,'read');try{await expect(port.get({connectorId:f.connectorId,expectedRevision:first.revision,resourceId:first.items[0].id},signal())).rejects.toMatchObject({code:'REPOSITORY_REVISION_CHANGED'});expect(reads).toHaveBeenCalledTimes(1)}finally{reads.mockRestore()}
  }finally{await f.cleanup()}
});

it('canonical和公开投影保留仓库scope；匹配伪造receipt仍不能把list改成get或项目证据',()=>{
  const identity={workspaceId:'workspace',taskId:'main',runId:'run'},scope={kind:'repository' as const,workspaceId:identity.workspaceId,connectorId:'.cbim/connectors/repo',repositoryId:randomUUID(),connectionId:randomUUID(),operation:'list' as const},call={id:'lookup',name:'cbim_repository_list',input:{connectorId:scope.connectorId}},decision={allow:true,effects:['read'] as const,scope},result={content:[{type:'text',text:'PRIVATE_RESOURCE_TEXT'}]},receipt=toolReceipt(identity,call,decision,'succeeded',result);
  const task:TaskSpec={...identity,root:path.resolve('workspace'),goal:'查询资料',acceptance:[],moduleIds:[],mode:'chat'};
  const events:StoredEvent[]=[['tool.proposed',call],['tool.allowed',{...call,...decision}],['tool.finished',{...call,result,receipt,isError:false}]].map(([type,data],index)=>({version:1,seq:index+1,...identity,type:type as StoredEvent['type'],data:data as Record<string,unknown>,time:new Date().toISOString()}));
  const summary:RunSummary={task,runId:identity.runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events,toolReceipts:[receipt]};expect(executionToolFacts(summary,{binding:identity})).toMatchObject({invalid:false,counts:{succeeded:1}});
  const safe=projectRunEvent(events[2],identity,task);expect((safe.data.receipt as any).scope).toEqual(scope);expect(JSON.stringify(safe)).not.toContain('PRIVATE_RESOURCE_TEXT');expect(projectRunEvent(events[1],identity,task).data.scope).toEqual(scope);
  for(const altered of [{...scope,operation:'get'},{kind:'workspace',workspaceId:identity.workspaceId},{...scope,connectorId:'.cbim/connectors/other'}]){const broken=structuredClone(summary);(broken.events[1].data as any).scope=altered;(broken.events[2].data.receipt as any).scope=altered;(broken.toolReceipts![0] as any).scope=altered;expect(executionToolFacts(broken,{binding:identity}).invalid).toBe(true)}
});
