import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {RemoteRepository} from '../src/logic/resources/service';
import {RepositoryConnectionStore} from '../src/logic/connectors/service/repository-connection-store';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}};
async function configured(){const f=await fixture(),folder=path.join(f.temp,'repo');await fs.mkdir(folder);await f.app.resources.configure({mode:'local',location:folder});await f.app.resources.startSharing({lan:false,port:0});const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),identity={workspaceId:entry.id,instanceId:ws.instanceId},repositoryId=f.app.resources.status().config!.repositoryId,connectorId='.cbim/connectors/team_resources';
  const preview=await f.app.repositoryConnections.preview({...identity,revision:(await ws.read()).revision,repositoryId,connectorId,name:'团队资料',summary:'显式只读查询'});return {...f,ws,identity,repositoryId,connectorId,preview};
}
async function granted(){const f=await configured();await f.app.repositoryConnections.commit({...f.identity,planId:f.preview.planId});const input={...f.identity,connectorId:f.connectorId,repositoryId:f.repositoryId,definitionHash:f.preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()},receipt=await f.app.repositoryConnections.grant(input);return {...f,input,receipt,check:{...f.identity,connectorId:f.connectorId,expectedGrantRevision:receipt.grant.revision}}}

it('登记已提交但缓存回执写失败，按原planId只读查真实journal；旧实例不重提交',async()=>{
  const f=await configured();try{const service=f.app.repositoryConnections,save=vi.spyOn(service as any,'savePlan').mockRejectedValueOnce(Error('isolated cache failure')),commit=vi.spyOn(f.ws,'commit');
    await expect(service.commit({...f.identity,planId:f.preview.planId})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_APPLIED'});save.mockRestore();expect(commit).toHaveBeenCalledTimes(1);
    const after=await f.ws.read(),lookup={workspaceId:f.identity.workspaceId,planId:f.preview.planId},receipt=await service.commitReceipt(lookup);expect(receipt).toMatchObject({identity:f.identity,state:'committed',definitionHash:f.preview.definitionHash});expect((await service.list(f.identity)).connections[0].status).toBe('not_granted');
    expect(await service.commitReceipt(lookup)).toEqual(receipt);expect(commit).toHaveBeenCalledTimes(1);expect((await f.ws.read()).revision).toBe(after.revision);
    const replacement=await f.app.open(f.identity.workspaceId,true);expect(replacement.instanceId).not.toBe(f.identity.instanceId);expect(await service.commitReceipt(lookup)).toEqual(receipt);await expect(service.commit({...f.identity,planId:f.preview.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    expect((await service.unaccepted({...f.identity,action:'commit',id:f.preview.planId})).unaccepted).toBe(false);
  }finally{await f.cleanup()}
});

it('未知命令只能在旧实例退役且完全无记录时证明未受理，同实例/已有授权均不能解除',async()=>{
  const f=await configured();try{const s=f.app.repositoryConnections,commandId=randomUUID(),commit={...f.identity,action:'commit',id:f.preview.planId},grant={...f.identity,action:'grant',id:commandId};
    expect((await s.unaccepted(commit)).unaccepted).toBe(false);expect((await s.unaccepted(grant)).unaccepted).toBe(false);await f.app.open(f.identity.workspaceId,true);
    expect((await s.unaccepted(commit)).unaccepted).toBe(true);expect((await s.unaccepted(grant)).unaccepted).toBe(true);expect(await s.commitReceipt({workspaceId:f.identity.workspaceId,planId:f.preview.planId})).toBeUndefined();
    const journal=path.join(f.ws.paths.local(f.identity.workspaceId,'transactions'),f.preview.planId+'.json');await fs.mkdir(path.dirname(journal),{recursive:true});await fs.writeFile(journal,'broken, not absent');expect((await s.unaccepted(commit)).unaccepted).toBe(false);await fs.unlink(journal);
  }finally{await f.cleanup()}
});

it('HTTP已读后撤销拒绝迟到结果，回放旧grant回执不会重新启用授权',async()=>{
  const f=await granted(),entered=deferred(),release=deferred(),original=RemoteRepository.prototype.read,reader=vi.spyOn(RemoteRepository.prototype,'read').mockImplementation(async function(this:RemoteRepository,signal){const result=await original.call(this,signal);entered.resolve();await release.promise;return result});
  try{const pending=f.app.repositoryConnections.check(f.check),observed=pending.catch(error=>error);await entered.promise;
    const revoked=await f.app.repositoryConnections.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});expect(revoked.grant.enabled).toBe(false);release.resolve();expect(await observed).toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});
    expect(await f.app.repositoryConnections.grant(f.input)).toEqual(f.receipt);await expect(f.app.repositoryConnections.check({...f.check,expectedGrantRevision:2})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_GRANTED'});expect(reader).toHaveBeenCalledTimes(1);
  }finally{release.resolve();reader.mockRestore();await f.cleanup()}
});

it('HTTP等待期间正式定义变更拒绝旧结果，不替换为当前来源',async()=>{
  const f=await granted(),entered=deferred(),release=deferred(),original=RemoteRepository.prototype.read,reader=vi.spyOn(RemoteRepository.prototype,'read').mockImplementation(async function(this:RemoteRepository,signal){const result=await original.call(this,signal);entered.resolve();await release.promise;return result});
  try{const pending=f.app.repositoryConnections.check(f.check),observed=pending.catch(error=>error);await entered.promise;const snapshot=await f.ws.read(),file=snapshot.files.find(item=>item.path==='.cbim/connectors/registry.json')!,data=JSON.parse(file.text);data.connectors[0].name='Changed definition';await f.ws.commit(request(snapshot,[{path:file.path,text:JSON.stringify(data)}]));release.resolve();expect(await observed).toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});expect((await f.app.repositoryConnections.list(f.identity)).connections[0].status).toBe('definition_changed');
  }finally{release.resolve();reader.mockRestore();await f.cleanup()}
});

it('授权HTTP预检期间工作区关闭后不保存授权或命令回执',async()=>{
  const f=await configured();await f.app.repositoryConnections.commit({...f.identity,planId:f.preview.planId});const entered=deferred(),release=deferred(),original=RemoteRepository.prototype.read,reader=vi.spyOn(RemoteRepository.prototype,'read').mockImplementation(async function(this:RemoteRepository,signal){const result=await original.call(this,signal);entered.resolve();await release.promise;return result});
  const input={...f.identity,connectorId:f.connectorId,repositoryId:f.repositoryId,definitionHash:f.preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()};
  try{const pending=f.app.repositoryConnections.grant(input),observed=pending.catch(error=>error);await entered.promise;await f.app.stop(f.identity.workspaceId);release.resolve();expect(await observed).toMatchObject({code:'NOT_RUNNING'});expect(f.app.repositoryConnections.receipt({workspaceId:f.identity.workspaceId,commandId:input.commandId})).toBeUndefined();
  }finally{release.resolve();reader.mockRestore();await f.cleanup()}
});

it('有效计划中的伪造committed缓存不能替代真实知识提交journal',async()=>{
  const f=await configured();try{const file=path.join(f.ws.paths.local(f.identity.workspaceId,'cache'),'repository-connections',f.preview.planId+'.json'),plan=JSON.parse(await fs.readFile(file,'utf8')),before=await f.ws.read();
    plan.committed={identity:f.identity,planId:f.preview.planId,connectorId:f.connectorId,repositoryId:f.repositoryId,definitionHash:f.preview.definitionHash,knowledgeRevision:before.revision,state:'committed',changed:[]};await fs.writeFile(file,JSON.stringify(plan));
    await expect(f.app.repositoryConnections.commit({...f.identity,planId:f.preview.planId})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_DATA'});expect(await f.app.repositoryConnections.commitReceipt({workspaceId:f.identity.workspaceId,planId:f.preview.planId})).toBeUndefined();expect((await f.ws.read()).revision).toBe(before.revision);
  }finally{await f.cleanup()}
});

it('授权文件缺历史、孤儿记录或改写当前状态全部拒绝，不能误证已受理命令不存在',async()=>{
  const f=await granted();try{const file=path.join(f.user,'repository-connections.json'),raw=await fs.readFile(file,'utf8'),base=JSON.parse(raw);
    for(const alter of [(state:any)=>state.commands=[],(state:any)=>state.grants=[],(state:any)=>state.grants[0].enabled=false,(state:any)=>{state.grants[0].revision=2;state.commands[0].receipt.grant.revision=2},(state:any)=>state.commands[0].receipt.action='revoke']){const state=structuredClone(base);alter(state);await fs.writeFile(file,JSON.stringify(state));await expect(new RepositoryConnectionStore(file).init()).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_DATA'})}
    await fs.writeFile(file,raw);const restored=new RepositoryConnectionStore(file);await restored.init();expect(restored.receipt(f.identity.workspaceId,f.input.commandId)).toEqual(f.receipt);
  }finally{await f.cleanup()}
});
