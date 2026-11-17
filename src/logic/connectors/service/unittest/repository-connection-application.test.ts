import {required} from '../../../../../scripts/unittest/support/assertions';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../../application/unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import type {RepositoryConnectionPreview,RepositoryConnectionCommit,RepositoryConnectionReceipt,RepositoryConnectionCheck,RepositoryConnectionList} from '../../rules/repository-connection';
import {seedRepositoryConnection,repositoryConnectionFixture as data,repositoryConnectionRunFiles} from './support/repository-connection-fixture';

async function definition(app:Application,workspaceId:string,repositoryId:string){
  const workspace=app.Workspace(workspaceId),snapshot=await workspace.Snapshot(),identity={workspaceId,instanceId:workspace.instanceId};
  const preview=await app.Dispatch('resources.connection.preview',{...identity,revision:snapshot.revision,repositoryId,connectorId:data.connectorId,name:'只读共享资料',summary:'当前应用共享仓库的独立工作区访问定义'}) as RepositoryConnectionPreview;
  expect(preview.identity).toEqual(identity);expect(preview.validation.structural).toBe(true);expect((await workspace.Snapshot()).revision).toBe(snapshot.revision);expect(JSON.stringify(preview.definition)).not.toMatch(/(?:"token"|"url"|"location")/);
  const committed=await app.Dispatch('resources.connection.commit',{...identity,planId:preview.planId}) as RepositoryConnectionCommit;
  expect(committed.state).toBe('committed');expect(committed.definitionHash).toBe(preview.definitionHash);return {identity,preview,committed};
}

it('actual Application gives only the selected workspace read-only HTTP access; revocation and stopped sharing never fall back to disk',async()=>{
  const f=await fixture();const actualFetch=globalThis.fetch,observed:Array<{url:string;method:string}>=[];
  vi.spyOn(globalThis,'fetch').mockImplementation((input,options)=>{observed.push({url:String(input),method:options?.method??'GET'});return actualFetch(input,options)});
  try{
    const seeded=await seedRepositoryConnection(f.app,f.temp),repository=await f.app.Dispatch('resources.list');await f.app.Dispatch('resources.share',{lan:false,port:0});const status=await f.app.Dispatch('resources.status');expect(required(status.sharing).host).toBe('127.0.0.1');
    const a=await definition(f.app,seeded.first.id,repository.repositoryId),b=await definition(f.app,seeded.second.id,repository.repositoryId),readList=async(identity:typeof a.identity)=>await f.app.Dispatch('resources.connection.list',identity) as RepositoryConnectionList;
    expect((await readList(a.identity)).connections.find(value=>value.connectorId===data.connectorId)?.status).toBe('not_granted');expect((await readList(b.identity)).connections.find(value=>value.connectorId===data.connectorId)?.status).toBe('not_granted');
    const request={...a.identity,connectorId:data.connectorId,repositoryId:repository.repositoryId,definitionHash:a.preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()},grant=await f.app.Dispatch('resources.connection.grant',request) as RepositoryConnectionReceipt;expect(grant.grant.enabled).toBe(true);
    const before=observed.length,check=await f.app.Dispatch('resources.connection.check',{...a.identity,connectorId:data.connectorId,expectedGrantRevision:grant.grant.revision}) as RepositoryConnectionCheck;
    expect(observed.slice(before)).toEqual([{url:required(status.sharing).url+'/v1/resources',method:'GET'}]);expect(check).toMatchObject({identity:a.identity,repositoryId:repository.repositoryId,connectorId:data.connectorId,itemCount:1,transport:'http',readOnly:true,revision:repository.revision});expect(check.items).toEqual([expect.objectContaining({id:repository.items[0].id,name:data.name,summary:data.summary})]);expect(JSON.stringify(check)).not.toMatch(/(?:"content"|"token"|"url"|"location")/);expect(JSON.stringify(check)).not.toContain('RESOURCE_CONNECTION_HTTP_FACT_17b1');
    const afterRead=observed.length;await expect(f.app.Dispatch('resources.connection.check',{...b.identity,connectorId:data.connectorId,expectedGrantRevision:0})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_GRANTED'});expect(observed).toHaveLength(afterRead);expect((await readList(b.identity)).connections.find(value=>value.connectorId===data.connectorId)?.status).toBe('not_granted');
    expect(await f.app.Dispatch('resources.connection.receipt',{workspaceId:seeded.first.id,commandId:request.commandId})).toEqual(grant);expect(await f.app.Dispatch('resources.connection.receipt',{workspaceId:seeded.second.id,commandId:request.commandId})).toBeUndefined();expect(observed).toHaveLength(afterRead);
    const revoke=await f.app.Dispatch('resources.connection.revoke',{...a.identity,connectorId:data.connectorId,expectedGrantRevision:grant.grant.revision,commandId:randomUUID()}) as RepositoryConnectionReceipt;expect(revoke.grant.enabled).toBe(false);await expect(f.app.Dispatch('resources.connection.check',{...a.identity,connectorId:data.connectorId,expectedGrantRevision:revoke.grant.revision})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_GRANTED'});expect(observed).toHaveLength(afterRead);
    const again=await f.app.Dispatch('resources.connection.grant',{...request,expectedGrantRevision:revoke.grant.revision,commandId:randomUUID()}) as RepositoryConnectionReceipt;const beforeStop=observed.length,bytes=await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8');await f.app.Dispatch('resources.stopSharing');
    expect((await readList(a.identity)).connections.find(value=>value.connectorId===data.connectorId)?.status).toBe('not_shared');await expect(f.app.Dispatch('resources.connection.check',{...a.identity,connectorId:data.connectorId,expectedGrantRevision:again.grant.revision})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_SHARED'});expect(observed).toHaveLength(beforeStop);expect(await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8')).toBe(bytes);expect((await f.app.Dispatch('resources.list')).items).toEqual(repository.items);
    expect(await repositoryConnectionRunFiles(f.user,[seeded.first.id,seeded.second.id])).toEqual([]);expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);
  }finally{vi.restoreAllMocks();await f.cleanup()}
},60000);

it('restarting preserves explicit definitions and grant receipts but never restarts sharing, reads HTTP or starts a model',async()=>{
  const f=await fixture();let app=f.app;const actualFetch=globalThis.fetch,observed:string[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation((input,options)=>{observed.push(String(input));return actualFetch(input,options)});
  try{
    const seeded=await seedRepositoryConnection(app,f.temp),repository=await app.Dispatch('resources.list');await app.Dispatch('resources.share',{lan:false,port:0});const a=await definition(app,seeded.first.id,repository.repositoryId);
    const request={...a.identity,connectorId:data.connectorId,repositoryId:repository.repositoryId,definitionHash:a.preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()},grant=await app.Dispatch('resources.connection.grant',request) as RepositoryConnectionReceipt,check=await app.Dispatch('resources.connection.check',{...a.identity,connectorId:data.connectorId,expectedGrantRevision:grant.grant.revision}) as RepositoryConnectionCheck;
    const count=observed.length,knowledge=(await app.Workspace(seeded.first.id).Snapshot()).files,bytes=await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8');await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
    expect((await app.Dispatch('resources.status')).sharing).toBeUndefined();expect(observed).toHaveLength(count);const identity={workspaceId:seeded.first.id,instanceId:app.Workspace(seeded.first.id).instanceId};expect(identity.instanceId).not.toBe(a.identity.instanceId);expect((await app.Workspace(seeded.first.id).Snapshot()).files).toEqual(knowledge);
    const list=await app.Dispatch('resources.connection.list',identity) as RepositoryConnectionList;expect(list.connections.find(value=>value.connectorId===data.connectorId)).toMatchObject({status:'not_shared',grantRevision:grant.grant.revision,grant:{enabled:true}});expect(await app.Dispatch('resources.connection.receipt',{workspaceId:seeded.first.id,commandId:request.commandId})).toEqual(grant);await expect(app.Dispatch('resources.connection.check',{...identity,connectorId:data.connectorId,expectedGrantRevision:grant.grant.revision})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_SHARED'});expect(observed).toHaveLength(count);
    await app.Dispatch('resources.share',{lan:false,port:0});const next=await app.Dispatch('resources.connection.check',{...identity,connectorId:data.connectorId,expectedGrantRevision:grant.grant.revision}) as RepositoryConnectionCheck;expect(next.connectionId).not.toBe(check.connectionId);expect(next.repositoryId).toBe(check.repositoryId);expect(next.items).toEqual(check.items);expect(observed).toHaveLength(count+1);expect(await fs.readFile(path.join(seeded.repository,'cbim-resources.json'),'utf8')).toBe(bytes);expect(await repositoryConnectionRunFiles(f.user,[seeded.first.id,seeded.second.id])).toEqual([]);expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);
  }finally{vi.restoreAllMocks();await app.Shutdown();await f.cleanup()}
},60000);
