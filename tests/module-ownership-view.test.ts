import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ModuleOwnershipPreviewInput,ModuleOwnershipPreview,ModuleOwnershipCommitInput,ModuleOwnershipReceipt,ModuleOwnershipDetail,ModuleOwnershipPage} from '../src/bridge/contracts/module-ownership';
import {ModuleOwnershipCommands,ModuleOwnershipCommandPool,checkedModuleOwnershipPage,checkedModuleOwnershipDetail,checkedModuleOwnershipPreview,checkedModuleOwnershipReceipt,moduleOwnershipPreRejected,type ModuleOwnershipCommandPorts} from '../src/frontend/workspace/module-ownership-state';
import {ModuleOwnershipDetailView} from '../src/frontend/workspace/ModuleOwnershipDetail';

const hash='a'.repeat(64),otherHash='b'.repeat(64),time='2026-11-07T14:00:00.000Z';
const identity={workspaceId:'workspace',instanceId:randomUUID()},moduleId='.cbim/workspace/client';
const owner={memberId:randomUUID(),revision:1,name:'实现岗位',position:'维护本模块',state:'active' as const,agentId:'cbim:executor',teamId:'.cbim/team',profileId:randomUUID(),modelId:'model',createdAt:time,updatedAt:time};
const change={moduleId,expectedBinding:null,nextOwner:{memberId:owner.memberId,expectedRevision:owner.revision},reason:'明确当前维护责任'};
const input:ModuleOwnershipPreviewInput={...identity,change};
const preview:ModuleOwnershipPreview={identity,readOnly:true,change,ownershipCursor:null,basis:hash,checkedAt:time,previous:null,nextOwner:owner,observedModule:{knowledgeRevision:hash,definitionHash:hash,observedAt:time},impact:{coverage:'dispatch_graph_tasks_with_module',total:0,counts:{unclaimed:0,inFlight:0,checkpointed:0,terminal:0,other:0},digest:otherHash},issues:[]};
const cursor={kind:'module_ownership' as const,workspaceId:identity.workspaceId,streamId:randomUUID(),seq:1};
function receipt(request:ModuleOwnershipCommitInput):ModuleOwnershipReceipt{return {identity,commandId:request.commandId,action:'assign',actor:{kind:'local_desktop',interaction:'explicit_submit'},changeId:randomUUID(),moduleId,bindingId:randomUUID(),previousRevision:0,revision:1,previousOwnerMemberId:null,ownerMemberId:owner.memberId,ownershipCursor:cursor,basis:hash,bindingHash:hash,committedAt:time}}
function fixture(extra:Partial<ModuleOwnershipCommandPorts>={}){const saved=new Map<string,string>();const ports:ModuleOwnershipCommandPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},commit:vi.fn(async request=>receipt(request)),lookup:vi.fn(async()=>undefined),uuid:randomUUID,...extra};return {saved,ports,controller:new ModuleOwnershipCommands(identity.workspaceId,ports)}}
function page():ModuleOwnershipPage{return {identity,readOnly:true,checkedAt:time,basis:{ownershipCursor:null,memberRegistryCursor:null,knowledgeRevision:hash},offset:0,total:1,items:[{moduleId,module:{name:'客户端',summary:'<script>not executable</script>'},binding:null,status:'unassigned',source:{status:'observed',knowledgeRevision:hash,definitionHash:hash}}]}}
function detail():ModuleOwnershipDetail{return {identity,readOnly:true,checkedAt:time,basis:page().basis,view:page().items[0],history:{total:0,truncated:false,items:[]}}}

it('预览固定当前模块、岗位和原关系，当前来源观察不冒充已登记',()=>{
  expect(checkedModuleOwnershipPreview(preview,input)).toEqual(preview);
  for(const bad of [{...preview,identity:{...identity,instanceId:randomUUID()}},{...preview,change:{...change,moduleId:moduleId+'/other'}},{...preview,nextOwner:{...owner,memberId:randomUUID()}},{...preview,nextOwner:{...owner,state:'suspended'}},{...preview,observedModule:undefined}])expect(()=>checkedModuleOwnershipPreview(bad,input)).toThrow();
  const p=page();expect(checkedModuleOwnershipPage(p,identity)).toEqual(p);expect(()=>checkedModuleOwnershipPage({...p,items:[{...p.items[0],source:{...p.items[0].source,status:'same'}}]},identity)).toThrow();
});

it('分页核三项依据及前进，反查不接受其他岗位，详情不接受其他模块',()=>{
  const p=page();for(const bad of [{...p,offset:1},{...p,total:2,items:[],nextOffset:1},{...p,identity:{...identity,workspaceId:'other'}},{...p,total:2,nextOffset:2}])expect(()=>checkedModuleOwnershipPage(bad,identity)).toThrow();
  expect(()=>checkedModuleOwnershipPage(p,{...identity,expectedReadBasis:{...p.basis,knowledgeRevision:otherHash}})).toThrow();
  expect(()=>checkedModuleOwnershipPage(p,{...identity,memberId:owner.memberId})).toThrow();
  const d=detail();expect(checkedModuleOwnershipDetail(d,{...identity,moduleId})).toEqual(d);expect(()=>checkedModuleOwnershipDetail(d,{...identity,moduleId:moduleId+'/other'})).toThrow();
});

it('回执固定原身份、当前选择及本机来源，后续查询不能更换任何已受理事实',()=>{
  const request={...input,commandId:randomUUID(),expectedOwnershipCursor:null,expectedBasis:hash},value=receipt(request);
  expect(checkedModuleOwnershipReceipt(value,request)).toEqual(value);
  for(const bad of [{...value,commandId:randomUUID()},{...value,moduleId:moduleId+'/other'},{...value,ownerMemberId:randomUUID()},{...value,basis:otherHash},{...value,bindingId:randomUUID()},{...value,actor:{kind:'main_agent',rootSessionId:'root',scopeId:'scope',agentInstanceId:'agent',agentSessionId:'channel',runId:'run',toolCallId:'call',toolName:'cbim_module_owner_change_commit'}}])expect(()=>checkedModuleOwnershipReceipt(bad,request,value)).toThrow();
});

it('发送前保存完整请求，双击与跨面板共享不会并发创建两次命令',async()=>{
  let resolve!:(value:ModuleOwnershipReceipt)=>void,captured!:ModuleOwnershipCommitInput;const wait=new Promise<ModuleOwnershipReceipt>(done=>{resolve=done});
  const f=fixture({commit:vi.fn(async request=>{captured=request;expect(JSON.parse([...f.saved.values()][0]).records[0].request).toEqual(request);return wait})});
  const first=f.controller.submit(input,preview);await f.controller.submit(input,preview);expect(f.ports.commit).toHaveBeenCalledTimes(1);expect(f.controller.blocked).toBe(true);resolve(receipt(captured));await first;expect(f.controller.snapshot.records[0].phase).toBe('accepted');
  const pool=new ModuleOwnershipCommandPool();expect(pool.get(identity.workspaceId,f.ports)).toBe(pool.get(identity.workspaceId,f.ports));
});

it('回复未知后重建只查原命令，回执原实例不被新UI实例改写',async()=>{
  let accepted!:ModuleOwnershipReceipt;const f=fixture({commit:vi.fn(async request=>{accepted=receipt(request);throw Error('IPC_TIMEOUT')}),lookup:vi.fn(async()=>accepted)});
  await f.controller.submit(input,preview);const request=f.controller.snapshot.records[0].request;
  await f.controller.submit({...input,instanceId:randomUUID()},preview);expect(f.ports.commit).toHaveBeenCalledTimes(1);
  const restored=new ModuleOwnershipCommands(identity.workspaceId,f.ports);await restored.restore();expect(f.ports.commit).toHaveBeenCalledTimes(1);expect(f.ports.lookup).toHaveBeenCalledWith({workspaceId:identity.workspaceId,commandId:request.commandId});expect(restored.snapshot.records[0].request).toEqual(request);expect(restored.snapshot.records[0].receipt).toEqual(accepted);
});

it('空查询及晚到预拒仍是未知，明确重送保持完全相同的请求',async()=>{
  const commit=vi.fn(async()=>{throw Error('IPC_TIMEOUT')}),f=fixture({commit});await f.controller.submit(input,preview);const original=f.controller.snapshot.records[0];await f.controller.query(original.request.commandId);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  commit.mockImplementation(async()=>{throw Error('OWNERSHIP_MEMBER_UNAVAILABLE: 岗位暂停')});await f.controller.retry(original.request.commandId);expect(commit.mock.calls[0]).toEqual(commit.mock.calls[1]);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  for(const code of ['OWNERSHIP_INPUT','OWNERSHIP_MEMBER_CHANGED','OWNERSHIP_BINDING_STALE'])expect(moduleOwnershipPreRejected(Error(code+': 拒绝'))).toBe(true);
  for(const code of ['OWNERSHIP_COMMAND_CONFLICT','OWNERSHIP_RECEIPT_INVALID','OWNERSHIP_UNAVAILABLE','OWNERSHIP_ACTOR','GRAPH_STORAGE_FAILED','OWNERSHIP_NEW_ERROR'])expect(moduleOwnershipPreRejected(Error(code+': 未确认'))).toBe(false);
  const rejected=fixture({commit:async()=>{throw Error('OWNERSHIP_BASIS_STALE: 已过期')}});await rejected.controller.submit(input,preview);expect(rejected.controller.snapshot.records[0].phase).toBe('rejected');expect(rejected.controller.blocked).toBe(false);
});

it('提交后坏回包保留原命令，已受理回执不被矛盾查询覆盖',async()=>{
  const f=fixture({commit:async request=>({...receipt(request),basis:otherHash})});await f.controller.submit(input,preview);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  const g=fixture();await g.controller.submit(input,preview);const accepted=g.controller.snapshot.records[0];g.ports.lookup=async()=>({...accepted.receipt,ownerMemberId:randomUUID()});await g.controller.query(accepted.request.commandId);expect(g.controller.snapshot.records[0].receipt).toEqual(accepted.receipt);expect(g.controller.snapshot.records[0].phase).toBe('accepted');
});

it('本机保存失败不先发送，保存成功后的本机故障仍保留已受理并可查修复',async()=>{
  const f=fixture({storage:{getItem:()=>null,setItem:()=>{throw Error('quota')}}});await f.controller.submit(input,preview);expect(f.ports.commit).not.toHaveBeenCalled();expect(f.controller.blocked).toBe(true);
  let writes=0;const saved=new Map<string,string>(),g=fixture({storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{if(++writes===2)throw Error('quota');saved.set(key,value)}}});await g.controller.submit(input,preview);const accepted=g.controller.snapshot.records[0];expect(accepted.phase).toBe('accepted');expect(g.controller.blocked).toBe(true);g.ports.lookup=async()=>accepted.receipt;await g.controller.query(accepted.request.commandId);expect(g.controller.blocked).toBe(false);expect(g.ports.commit).toHaveBeenCalledTimes(1);
  const corrupt=fixture({storage:{getItem:()=>'{broken',setItem:vi.fn()}});await corrupt.controller.submit(input,preview);expect(corrupt.ports.commit).not.toHaveBeenCalled();expect(corrupt.controller.blocked).toBe(true);
});

it('本机记录不能把已有未知事实伪装成明确未受理',async()=>{
  const f=fixture({commit:async()=>{throw Error('IPC_TIMEOUT')}});await f.controller.submit(input,preview);const key=f.controller.storageKey,raw=JSON.parse(f.saved.get(key)!);raw.records[0].phase='rejected';f.saved.set(key,JSON.stringify(raw));
  const restored=new ModuleOwnershipCommands(identity.workspaceId,f.ports);expect(restored.blocked).toBe(true);expect(restored.snapshot.error).toContain('无法读取');
});

it('责任详情按文本展示来源限制和有界历史，不生成执行能力或解析内容脚本',()=>{
  const d=detail();d.view.module!.name='<script>bad</script>';const html=renderToStaticMarkup(createElement(ModuleOwnershipDetailView,{detail:d}));expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('尚未接入按负责人派发');expect(html).toContain('责任历史');
});
