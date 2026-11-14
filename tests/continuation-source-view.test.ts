import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ScopeContinuationController,type ContinuationPorts,type ContinuationTarget} from '../src/view/tasks/continuation-state';
import {continuationAttachments,appendContinuationAttachments} from '../src/view/tasks/continuation-attachments';
import {checkedMaterialTargets,checkedMaterialPage} from '../src/view/tasks/continuation-source-state';
import {continuationSourcePorts} from '../src/view/tasks/continuation-source-io';
import {ScopeContinuationForm} from '../src/view/tasks/ScopeContinuationForm';
import {ContinuationAttachmentHistory} from '../src/view/tasks/ContinuationAttachmentHistory';
import type {ScopeContinuationView} from '../src/view/tasks/useScopeContinuation';
import type {ContinuationAttachmentManifest} from '../src/bridge/contracts/dispatch';

const target:ContinuationTarget={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1};
const repository={workspaceId:'workspace',connectorId:'.cbim/connectors/docs',repositoryId:randomUUID(),connectionId:randomUUID(),name:'资料仓库',summary:'共享资料'};
const hash='a'.repeat(64),time='2026-11-07T12:00:00.000Z';
const options={provider:'cbim-11111111-1111-4111-8111-111111111111',profileId:'11111111-1111-4111-8111-111111111111',model:'test',permission:'ask' as const};
const item=(kind:'file'|'folder'|'link'|'web'|'repository_resource')=>({id:randomUUID(),kind,name:kind,source:kind==='web'||kind==='link'?'https://example.com/a':kind==='repository_resource'?'repository:reference':'C:/example'});
const page=()=>({scope:{kind:'repository' as const,workspaceId:'workspace',connectorId:repository.connectorId,repositoryId:repository.repositoryId,connectionId:repository.connectionId,operation:'list' as const},revision:hash,offset:0,totalItems:1,items:[{id:randomUUID(),kind:'skill' as const,name:'技能',summary:'资料',updatedAt:time}],readOnly:true as const});
function fixture(extra:Partial<ContinuationPorts>={}){
  const saved=new Map<string,string>(),ports:ContinuationPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},submit:vi.fn(async()=>{throw Error('IPC_TIMEOUT')}),lookup:async()=>undefined,uuid:randomUUID,...extra};
  const controller=new ScopeContinuationController('workspace','root',ports);controller.edit(target,'补充原目标');return {ports,controller,saved};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}

it('混合元数据原样持久、按身份去重，拒绝正文/凭据/旧connector/重复和超过12项',async()=>{
  const items=(['file','folder','link','web','repository_resource'] as const).map(item);
  const f=fixture({importSource:async choice=>items.filter(entry=>entry.kind===choice.kind)});
  for(const choice of [{kind:'file' as const},{kind:'folder' as const},{kind:'link' as const,value:'https://example.com/a'},{kind:'web' as const,value:'https://example.com/a'},{kind:'repository_resource' as const,connectorId:repository.connectorId,connectionId:repository.connectionId,expectedRevision:hash,resourceId:randomUUID()}])await f.controller.importSource(target,choice,()=>true);
  expect(f.controller.record('scope','wait')?.attachments).toEqual(items);
  expect(new ScopeContinuationController('workspace','root',f.ports).record('scope','wait')?.attachments).toEqual(items);
  expect(appendContinuationAttachments(items,[items[0]])).toEqual(items);
  for(const invalid of [[{...items[0],text:'private'}],[{...items[0],token:'secret'}],[{...items[0],kind:'connector'}],[items[0],items[0]],Array.from({length:13},()=>item('link'))])expect(()=>continuationAttachments(invalid)).toThrow();
  await f.controller.submit(target,options);expect(f.ports.submit).toHaveBeenCalledTimes(1);const request=vi.mocked(f.ports.submit).mock.calls[0][0];
  expect(request.input).toEqual({message:'补充原目标',attachmentIds:items.map(entry=>entry.id)});expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
  f.controller.removeFile(target,items[0].id);await f.controller.importSource(target,{kind:'folder'},()=>true);expect(f.controller.record('scope','wait')?.attachments).toEqual(items);
});

it('共享在途锁阻止同时导入、删除和提交；切换等待丢弃迟到结果',async()=>{
  const waiting=deferred<unknown>(),read=vi.fn(async()=>waiting.promise);const f=fixture({importSource:read});let current=true;
  const operation=f.controller.importSource(target,{kind:'folder'},()=>current);expect(f.controller.isImporting).toBe(true);expect(f.controller.canRelease).toBe(false);
  await f.controller.importSource(target,{kind:'link',value:'https://example.com'},()=>true);await f.controller.submit(target,options);expect(read).toHaveBeenCalledTimes(1);expect(f.ports.submit).not.toHaveBeenCalled();
  current=false;waiting.resolve([item('folder')]);await operation;expect(f.controller.record('scope','wait')?.attachments).toBeUndefined();expect(f.controller.isImporting).toBe(false);
});

it('取消绑定原等待，丢弃即使后端已成功返回的快照且不消费等待',async()=>{
  const waiting=deferred<unknown>();let signal:AbortSignal|undefined;const f=fixture({importSource:async(_,value)=>{signal=value;return waiting.promise}});
  const operation=f.controller.importSource(target,{kind:'web',value:'https://example.com'},()=>true);
  f.controller.cancelImport({...target,waitId:'other'});expect(signal?.aborted).toBe(false);
  f.controller.cancelImport(target);expect(signal?.aborted).toBe(true);waiting.resolve([item('web')]);await operation;
  expect(f.controller.record('scope','wait')?.attachments).toBeUndefined();expect(f.ports.submit).not.toHaveBeenCalled();expect(f.controller.snapshot.error).toBe('');
});

it('导入失败或错种类不覆盖原草稿，仓库目录须精确身份和版本',async()=>{
  const f=fixture({importSource:async()=>[item('link')]});await f.controller.importSource(target,{kind:'web',value:'https://example.com'},()=>true);expect(f.controller.snapshot.error).toContain('种类');expect(f.controller.record('scope','wait')?.text).toBe('补充原目标');
  const list={workspaceId:'workspace',instanceId:randomUUID(),targets:[repository]};expect(checkedMaterialTargets(list,'workspace')).toEqual([repository]);expect(()=>checkedMaterialTargets({...list,targets:[repository,repository]},'workspace')).toThrow();expect(()=>checkedMaterialTargets(list,'other')).toThrow();
  const value=page();expect(checkedMaterialPage(value,'workspace',{target:repository})).toEqual(value);
  for(const changed of [{...value,scope:{...value.scope,workspaceId:'other'}},{...value,scope:{...value.scope,connectionId:randomUUID()}},{...value,revision:'b'.repeat(64)}])expect(()=>checkedMaterialPage(changed,'workspace',{target:repository,expectedRevision:hash})).toThrow();
});

it('同一控制器的目录读取也共用锁，原生选择与取消使用同一importId',async()=>{
  const calls:Array<{action:string;args:any}>=[],waiting=deferred<any>();
  const io=continuationSourcePorts('workspace',async(action,args)=>{calls.push({action,args});return action==='chat.pick'?waiting.promise:{cancelled:true}},()=> '11111111-1111-4111-8111-111111111111');
  const abort=new AbortController(),promise=io.importSource!({kind:'folder'},abort.signal);abort.abort();waiting.resolve([]);await promise;
  expect(calls.map(entry=>entry.action)).toEqual(['chat.pick','chat.importCancel']);expect(calls[0].args.importId).toBe(calls[1].args.importId);expect(calls[0].args.kind).toBe('folder');
  const listWait=deferred<unknown>(),f=fixture({materialTargets:async()=>listWait.promise,importSource:vi.fn()});const load=f.controller.materialTargets(target,()=>true);
  await f.controller.importSource(target,{kind:'folder'},()=>true);expect(f.ports.importSource).not.toHaveBeenCalled();listWait.resolve({workspaceId:'workspace',instanceId:randomUUID(),targets:[repository]});expect(await load).toEqual([repository]);
});

it('等待表单展示来源与取消，未知历史没有可编辑来源入口，正文和来源以文本转义',()=>{
  const base:ScopeContinuationView={workspaceId:'workspace',attachments:[],importing:true,pickFiles:async()=>{},removeFile:()=>{},scopeId:'scope',waitId:'wait',text:'补充',editable:true,canSubmit:false,canRetry:false,pending:false,error:'',modelLabel:'model',edit:()=>{},submit:async()=>{},submitInput:async()=>{},query:async()=>{},retry:async()=>{},sourceSelectionKey:'a',importSource:async()=>{},materialTargets:async()=>undefined,materialList:async()=>undefined,cancelImport:()=>{}};
  const editable=renderToStaticMarkup(createElement(ScopeContinuationForm,{state:base}));for(const text of ['目录清单','仓库资料','取消资料准备','迟到结果不会加入草稿'])expect(editable).toContain(text);
  expect(renderToStaticMarkup(createElement(ScopeContinuationForm,{state:{...base,editable:false}}))).not.toContain('continuation-sources');
  const manifest:ContinuationAttachmentManifest={version:2,expandedMessageHash:hash,expandedMessageBytes:100,items:[{attachmentId:randomUUID(),kind:'link',name:'<script>unsafe</script>',snapshotHash:hash,contentHash:hash,byteLength:20,contentKind:'url_reference',proof:{kind:'link',mode:'url_only',url:'https://example.com/',savedTextBytes:20,capturedAt:time}}]};
  const history=renderToStaticMarkup(createElement(ContinuationAttachmentHistory,{manifest}));expect(history).toContain('链接指针（未抓取）');expect(history).toContain('&lt;script&gt;');expect(history).not.toContain('<script>');
});
