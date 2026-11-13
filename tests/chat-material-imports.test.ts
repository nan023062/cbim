import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {ChatInputs} from '../src/logic/materials/service/chat-inputs';
import {RemoteRepository} from '../src/logic/resources/service';
import {hash} from '../src/core/platform/node/serialization';
import {continuationSourceSnapshotSchema} from '../src/logic/tasks/rules/continuation-source-snapshot';

const signal=()=>new AbortController().signal;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}};
async function setup(){const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id);return {...f,id:entry.id,ws,inputs:new ChatInputs(ws),snapshots:path.join(ws.paths.project(entry.id),'chat-inputs')}}
async function saved(f:Awaited<ReturnType<typeof setup>>,id:string){return continuationSourceSnapshotSchema.parse(JSON.parse(await fs.readFile(path.join(f.snapshots,id+'.json'),'utf8')))}
async function server(handler:http.RequestListener){const value=http.createServer(handler);await new Promise<void>(done=>value.listen(0,'127.0.0.1',done));return {url:`http://127.0.0.1:${(value.address() as {port:number}).port}`,close:async()=>{value.closeAllConnections();await new Promise<void>(done=>value.close(()=>done()))}}}
async function connected(){
  const f=await setup(),folder=path.join(f.temp,'repository');await fs.mkdir(folder);await f.app.resources.configure({mode:'local',location:folder});let snapshot=await f.app.resources.read();
  for(const kind of ['connector','team','agent','skill','architecture','module','workflow'] as const)snapshot=await f.app.resources.save({repositoryId:snapshot.repositoryId,revision:snapshot.revision,item:{kind,name:kind,summary:'静态资料',content:kind==='workflow'?'字🧱'.repeat(13000):kind+' STATIC_MATERIAL'}});
  await f.app.resources.startSharing({lan:false,port:0});const identity={workspaceId:f.id,instanceId:f.ws.instanceId},connectorId='.cbim/connectors/materials';
  const preview=await f.app.repositoryConnections.preview({...identity,revision:(await f.ws.read()).revision,repositoryId:snapshot.repositoryId,connectorId,name:'资料仓库',summary:'仅静态资料'});
  await f.app.repositoryConnections.commit({...identity,planId:preview.planId});await f.app.repositoryConnections.grant({...identity,connectorId,repositoryId:snapshot.repositoryId,definitionHash:preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()});
  return {...f,identity,connectorId,snapshot,preview};
}

it('目录真实首层有界、过滤知识目录且不读取子文件，保存后变化不进入续跑',async()=>{
  const f=await setup();try{
    const folder=path.join(f.a,'materials');await fs.mkdir(folder);await fs.mkdir(path.join(folder,'.cbim'));await fs.mkdir(path.join(folder,'nested'));await fs.writeFile(path.join(folder,'nested','private.txt'),'MUST_NOT_READ');
    await Promise.all(Array.from({length:205},(_,index)=>fs.writeFile(path.join(folder,'entry-'+index+'.txt'),'BODY_NOT_READ')));
    const imported=await f.app.chatMaterials.pick({id:f.id,importId:randomUUID(),kind:'folder'},async()=>[folder]),snapshot=await saved(f,imported[0].id);
    expect(snapshot).toMatchObject({kind:'folder',proof:{mode:'first_level',entryLimit:200,entryCount:200,truncated:true}});expect(snapshot.text.split('\n')).toHaveLength(200);expect(snapshot.text).not.toMatch(/MUST_NOT_READ|BODY_NOT_READ|\.cbim/);
    await fs.writeFile(path.join(folder,'AFTER_IMPORT.txt'),'late');const prepared=await f.inputs.prepareContinuation('检查目录清单',[imported[0].id],signal());expect(prepared.manifest.version).toBe(2);expect(prepared.message).not.toContain('AFTER_IMPORT');expect(JSON.stringify(prepared.manifest)).not.toContain(folder);
  }finally{await f.cleanup()}
});

it('URL指针零fetch；真实网页同字节hash且UTF8摘录不切断字符，等待准备不再联网',async()=>{
  let calls=0;const raw=Buffer.from('<script>PRIVATE_SCRIPT</script><p>'+'字🧱'.repeat(14000)+'</p>'),web=await server((_request,response)=>{calls++;response.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(raw)}),f=await setup();
  try{
    const link=await f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'link',value:web.url}});expect(calls).toBe(0);
    const page=await f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'web',value:web.url}}),snapshot=await saved(f,page.id);expect(calls).toBe(1);expect(snapshot.proof).toMatchObject({kind:'web',rawBytes:raw.length,rawHash:hash(raw),truncated:true});expect(Buffer.byteLength(snapshot.text)).toBeLessThanOrEqual(65536);expect(snapshot.text).not.toContain('\uFFFD');expect(snapshot.text).not.toContain('PRIVATE_SCRIPT');
    const prepared=await f.inputs.prepareContinuation('读取已保存资料',[link.id,page.id],signal());expect(calls).toBe(1);expect(prepared.manifest.items.map(item=>item.contentKind)).toEqual(['url_reference','web_excerpt']);
  }finally{await web.close();await f.cleanup()}
});

it('网页原响应字节超限、跳转、错误类型及坏UTF8不保存快照',async()=>{
  const web=await server((request,response)=>{
    if(request.url==='/redirect'){response.writeHead(302,{location:'/text'}).end();return}
    if(request.url==='/binary'){response.writeHead(200,{'content-type':'application/octet-stream'}).end('body');return}
    response.writeHead(200,{'content-type':'text/plain'});response.end(request.url==='/invalid'?Buffer.from([255,254]):Buffer.alloc(1024*1024+1,120));
  }),f=await setup();try{
    for(const [route,code] of [['large','ATTACHMENT_WEB_LIMIT'],['redirect','ATTACHMENT_WEB_FETCH'],['binary','ATTACHMENT_WEB_TYPE'],['invalid','ATTACHMENT_WEB_ENCODING']])await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'web',value:web.url+'/'+route}})).rejects.toMatchObject({code});
    expect(await fs.readdir(f.snapshots).catch(()=>[])).toEqual([]);
  }finally{await web.close();await f.cleanup()}
});

it('取消真实响应正文立即结束且不保存；取消先到与重复ID都不重放',async()=>{
  const entered=deferred();let calls=0;const web=await server((_request,response)=>{calls++;response.writeHead(200,{'content-type':'text/plain'});response.write('partial');entered.resolve()}),f=await setup();
  try{
    const importId=randomUUID(),request={id:f.id,importId,attachment:{kind:'web',value:web.url}},pending=f.app.dispatch('chat.import',request).catch(error=>error);await entered.promise;
    expect(await f.app.dispatch('chat.importCancel',{id:f.id,importId})).toEqual({cancelled:true});expect(await pending).toMatchObject({code:'ATTACHMENT_IMPORT_CANCELLED'});
    await expect(f.app.dispatch('chat.import',request)).rejects.toMatchObject({code:'ATTACHMENT_IMPORT_CANCELLED'});const before=randomUUID();await f.app.dispatch('chat.importCancel',{id:f.id,importId:before});await expect(f.app.dispatch('chat.import',{...request,importId:before})).rejects.toMatchObject({code:'ATTACHMENT_IMPORT_CANCELLED'});expect(calls).toBe(1);expect(await fs.readdir(f.snapshots).catch(()=>[])).toEqual([]);
  }finally{await web.close();await f.cleanup()}
});

it('原生选择器取消或工作区退役后迟到路径不读取，关闭不等待对话框手动结束',async()=>{
  const f=await setup();try{
    const release=deferred(),entered=deferred(),importId=randomUUID(),file=path.join(f.a,'late.txt');await fs.writeFile(file,'late');
    const pending=f.app.chatMaterials.pick({id:f.id,importId,kind:'file'},async()=>{entered.resolve();await release.promise;return [file]}).catch(error=>error);await entered.promise;
    await f.app.stop(f.id);expect(await pending).toMatchObject({code:'ATTACHMENT_IMPORT_CANCELLED'});release.resolve();await new Promise(done=>setTimeout(done,10));expect(await fs.readdir(f.snapshots).catch(()=>[])).toEqual([]);
  }finally{await f.cleanup()}
});

it('真实已授权仓库七类资料各一次HTTP读取，正文标静态且版本哈希完整，撤销后保存快照仍可离线使用',async()=>{
  const f=await connected(),read=vi.spyOn(RemoteRepository.prototype,'read');try{
    const targets=await f.app.dispatch('chat.materialTargets',{id:f.id});expect(read).not.toHaveBeenCalled();const target=targets.targets[0];
    const listing=await f.app.dispatch('chat.materialList',{id:f.id,importId:randomUUID(),connectorId:f.connectorId,connectionId:target.connectionId}),ids:string[]=[];
    for(const item of listing.items){const attachment=await f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'repository_resource',connectorId:f.connectorId,connectionId:target.connectionId,expectedRevision:listing.revision,resourceId:item.id}}),snapshot=await saved(f,attachment.id),original=f.snapshot.items.find(value=>value.id===item.id)!;ids.push(attachment.id);
      expect(snapshot.proof).toMatchObject({kind:'repository_resource',resourceKind:item.kind,revision:listing.revision,definitionHash:f.preview.definitionHash,grantRevision:1,connectionId:target.connectionId,fullContentHash:hash(original.content),fullContentBytes:Buffer.byteLength(original.content),readOnly:true,transport:'http'});expect(Buffer.byteLength(snapshot.text)).toBeLessThanOrEqual(65536);expect(snapshot.note).toContain('不安装、不执行');
    }
    expect(read).toHaveBeenCalledTimes(8);await f.app.repositoryConnections.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});await f.app.resources.stopSharing();
    const prepared=await f.inputs.prepareContinuation('只读取当时保存的资料',ids,signal());expect(prepared.manifest.version).toBe(2);expect(prepared.manifest.items).toHaveLength(7);expect(read).toHaveBeenCalledTimes(8);expect(JSON.stringify(prepared.manifest)).not.toMatch(/token|http:\/\/127\.0\.0\.1/);
  }finally{read.mockRestore();await f.cleanup()}
});

it('仓库跨工作区、资源版本或共享代次失效不改选来源，真正读取后撤销也拒迟到保存',async()=>{
  const f=await connected();try{
    const target=(await f.app.chatMaterials.targets({id:f.id})).targets[0],selection={kind:'repository_resource' as const,connectorId:f.connectorId,connectionId:target.connectionId,expectedRevision:f.snapshot.revision,resourceId:f.snapshot.items[0].id};
    const other=await f.app.dispatch('add',{path:f.b});await expect(f.app.dispatch('chat.import',{id:other.id,importId:randomUUID(),attachment:selection})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_NOT_GRANTED'});
    await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{...selection,expectedRevision:'0'.repeat(64)}})).rejects.toMatchObject({code:'REPOSITORY_REVISION_CHANGED'});
    await f.app.resources.stopSharing();await f.app.resources.startSharing({lan:false,port:0});await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:selection})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});
    const fresh=(await f.app.chatMaterials.targets({id:f.id})).targets[0],original=RemoteRepository.prototype.read,read=vi.spyOn(RemoteRepository.prototype,'read').mockImplementation(async function(this:RemoteRepository,abort){const value=await original.call(this,abort);await f.app.repositoryConnections.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});return value});
    try{await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{...selection,connectionId:fresh.connectionId}})).rejects.toMatchObject({name:'AbortError'});expect(read).toHaveBeenCalledTimes(1)}finally{read.mockRestore()}
    expect(await fs.readdir(f.snapshots).catch(()=>[])).toEqual([]);
  }finally{await f.cleanup()}
});

it('原始IPC拒绝自报proof/地址/授权，坏保存来源拒绝续跑，文件单独继续保留v1',async()=>{
  const f=await setup();try{
    const base={id:f.id,importId:randomUUID(),attachment:{kind:'link',value:'https://example.test/material'}};
    await expect(f.app.dispatch('chat.import',{...base,attachment:{...base.attachment,proof:{verified:true}}})).rejects.toMatchObject({code:'ATTACHMENT_IMPORT_INPUT'});
    const attachment=await f.app.dispatch('chat.import',base);await expect(f.app.dispatch('chat.import',base)).rejects.toMatchObject({code:'ATTACHMENT_IMPORT_REUSED'});
    const filename=path.join(f.snapshots,attachment.id+'.json'),snapshot=await saved(f,attachment.id);await fs.writeFile(filename,JSON.stringify({...snapshot,proof:{...snapshot.proof,savedTextBytes:1}}));await expect(f.inputs.prepareContinuation('bad',[attachment.id],signal())).rejects.toMatchObject({code:'GOAL_ATTACHMENT_INVALID'});
    const textfile=path.join(f.a,'file.txt');await fs.writeFile(textfile,'old file semantics');const file=await f.inputs.path('file',textfile);expect((await f.inputs.prepareContinuation('文件',[file.id],signal())).manifest.version).toBe(1);
  }finally{await f.cleanup()}
});

it('仓库读取后到落盘期间撤权仍不交付，已保存孤立快照不冒称已回滚或自动输入',async()=>{
  const f=await connected(),original=ChatInputs.prototype.saveSource,save=vi.spyOn(ChatInputs.prototype,'saveSource').mockImplementation(async function(this:ChatInputs,value,abort){
    const result=await original.call(this,value,abort);await f.app.repositoryConnections.revoke({...f.identity,connectorId:f.connectorId,expectedGrantRevision:1,commandId:randomUUID()});return result;
  });try{
    const target=(await f.app.chatMaterials.targets({id:f.id})).targets[0];await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'repository_resource',connectorId:f.connectorId,connectionId:target.connectionId,expectedRevision:f.snapshot.revision,resourceId:f.snapshot.items[0].id}})).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});
    expect(save).toHaveBeenCalledTimes(1);expect(await fs.readdir(f.snapshots)).toHaveLength(1);expect(await f.app.execution(f.id).list()).toEqual([]);
  }finally{save.mockRestore();await f.cleanup()}
});

it('取消先到的原生选择不启动对话框，网页无Content-Length仍按累计原字节拒绝',async()=>{
  const f=await setup(),web=await server((_request,response)=>{response.writeHead(200,{'content-type':'text/plain'});response.write(Buffer.alloc(600000,120));response.end(Buffer.alloc(600000,120))});try{
    const importId=randomUUID(),select=vi.fn(async()=>[]);await f.app.dispatch('chat.importCancel',{id:f.id,importId});expect(()=>f.app.chatMaterials.pick({id:f.id,importId,kind:'folder'},select)).toThrow();expect(select).not.toHaveBeenCalled();
    await expect(f.app.dispatch('chat.import',{id:f.id,importId:randomUUID(),attachment:{kind:'web',value:web.url}})).rejects.toMatchObject({code:'ATTACHMENT_WEB_LIMIT'});expect(await fs.readdir(f.snapshots).catch(()=>[])).toEqual([]);
  }finally{await web.close();await f.cleanup()}
});
