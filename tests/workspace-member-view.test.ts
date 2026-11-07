import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {WorkspaceMember,WorkspaceMemberPreviewInput,WorkspaceMemberPreview,WorkspaceMemberCommitInput,WorkspaceMemberReceipt,WorkspaceMemberDetail} from '../src/bridge/contracts/workspace-members';
import {WorkspaceMemberCommands,WorkspaceMemberCommandPool,checkedWorkspaceMemberPreview,checkedWorkspaceMemberReceipt,checkedWorkspaceMemberList,checkedWorkspaceMemberDetail,workspaceMemberPreRejected,type WorkspaceMemberCommandPorts} from '../src/frontend/team/workspace-member-state';
import {WorkspaceMemberForm} from '../src/frontend/team/WorkspaceMemberForm';
import {WorkspaceMemberDetailView} from '../src/frontend/team/WorkspaceMemberDetail';

const hash='a'.repeat(64),modelHash='b'.repeat(64),time='2026-11-07T13:00:00.000Z',profileId=randomUUID();
const identity={workspaceId:'workspace',instanceId:randomUUID()};
const configuration={workspaceId:'workspace',teamId:'.cbim/team',agentId:'cbim:executor',source:'builtin' as const,name:'默认执行者',knowledgeRevision:hash,principles:'<script>not executable</script>',effectiveSkills:[]};
const policy={profileId,modelId:'local-model',configurationHash:modelHash,snapshot:{id:profileId,name:'本机模型',api:'openai-completions' as const,baseUrl:'http://127.0.0.1:1234',auth:'none' as const,model:'local-model',contextWindow:200000,maxTokens:1000,reasoning:false}};
const input:WorkspaceMemberPreviewInput={...identity,change:{kind:'register',agentId:'cbim:executor',name:'岗位一',position:'核实业务成果',adaptation:{instructions:'按项目约束执行',references:[]},runtimePolicy:{profileId,modelId:'local-model'},reason:'明确登记能力'}};
const preview:WorkspaceMemberPreview={identity,change:input.change,registryCursor:null,basis:hash,checkedAt:time,previousRevision:0,proposed:{name:'岗位一',position:'核实业务成果',adaptation:{instructions:'按项目约束执行',references:[]},state:'active',capability:{configuration,capabilityHash:hash},runtimePolicy:policy},changedFields:['name','position','adaptation','capability','runtimePolicy','state']};
const cursor={kind:'workspace_registry' as const,workspaceId:'workspace',streamId:randomUUID(),seq:1};
function receipt(request:WorkspaceMemberCommitInput):WorkspaceMemberReceipt{return {identity,commandId:request.commandId,action:'register',changeId:randomUUID(),memberId:randomUUID(),previousRevision:0,memberRevision:1,registryCursor:cursor,basis:hash,memberHash:modelHash,committedAt:time}}
function fixture(extra:Partial<WorkspaceMemberCommandPorts>={}){const saved=new Map<string,string>();const ports:WorkspaceMemberCommandPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},commit:vi.fn(async request=>receipt(request)),lookup:vi.fn(async()=>undefined),uuid:randomUUID,...extra};return {saved,ports,controller:new WorkspaceMemberCommands('workspace',ports)}}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
function member():WorkspaceMember{return {workspaceId:'workspace',memberId:randomUUID(),revision:1,name:'岗位一',position:'核实业务成果',adaptation:{instructions:'按项目约束执行',references:[]},state:'active',adoption:{captureId:randomUUID(),capturedAt:time,knowledgeRevision:hash,capabilityHash:hash,configuration},runtimePolicy:policy,createdAt:time,updatedAt:time}}
function detail():WorkspaceMemberDetail{return {identity,registryCursor:cursor,member:member(),currentDiff:{checkedAt:time,capability:{status:'same',adoptedHash:hash,currentHash:hash},model:{status:'same',adoptedHash:modelHash,currentHash:modelHash}}}}

it('本机未知事实不能通过错误的拒绝标志恢复可写',async()=>{
  const f=fixture({commit:async()=>{throw Error('IPC_TIMEOUT')}});await f.controller.submit(input,preview);const key=f.controller.storageKey,raw=JSON.parse(f.saved.get(key)!);raw.records[0].phase='rejected';f.saved.set(key,JSON.stringify(raw));
  const restored=new WorkspaceMemberCommands('workspace',f.ports);expect(restored.blocked).toBe(true);expect(restored.snapshot.error).toContain('无法读取');
});

it('严格核对预览、原回执和分页身份，不接受另一选择或另一实例',()=>{
  expect(checkedWorkspaceMemberPreview(preview,input)).toEqual(preview);
  expect(()=>checkedWorkspaceMemberPreview({...preview,identity:{...identity,instanceId:randomUUID()}},input)).toThrow();
  expect(()=>checkedWorkspaceMemberPreview({...preview,proposed:{...preview.proposed,name:'其他岗位'}},input)).toThrow();
  const request={...input,commandId:randomUUID(),expectedBasis:hash,expectedRegistryCursor:null},value=receipt(request);
  expect(checkedWorkspaceMemberReceipt(value,request)).toEqual(value);for(const invalid of [{...value,commandId:randomUUID()},{...value,basis:modelHash},{...value,registryCursor:{...cursor,seq:2}},{...value,memberId:randomUUID()}])expect(()=>checkedWorkspaceMemberReceipt(invalid,request,value)).toThrow();
  const list={identity,registryCursor:null,offset:0,total:0,items:[]};expect(checkedWorkspaceMemberList(list,identity)).toEqual(list);expect(()=>checkedWorkspaceMemberList({...list,identity:{...identity,workspaceId:'other'}},identity)).toThrow();
  const data=detail();expect(checkedWorkspaceMemberDetail(data,{...identity,memberId:data.member.memberId})).toEqual(data);expect(()=>checkedWorkspaceMemberDetail(data,{...identity,memberId:randomUUID()})).toThrow();
});

it('先持久化再发送；双击与同工作区两个面板只产生一个命令',async()=>{
  const wait=deferred<WorkspaceMemberReceipt>();let captured!:WorkspaceMemberCommitInput;
  const f=fixture({commit:vi.fn(async request=>{captured=request;expect(f.saved.size).toBe(1);expect(JSON.parse([...f.saved.values()][0]).records[0].request).toEqual(request);return wait.promise})});
  const first=f.controller.submit(input,preview);await f.controller.submit(input,preview);expect(f.ports.commit).toHaveBeenCalledTimes(1);expect(f.controller.blocked).toBe(true);wait.resolve(receipt(captured));await first;expect(f.controller.snapshot.records[0].phase).toBe('accepted');expect(f.controller.blocked).toBe(false);
  const pool=new WorkspaceMemberCommandPool();expect(pool.get('workspace',f.ports)).toBe(pool.get('workspace',f.ports));
});

it('编辑和明确采纳的预览不能顺带改能力身份、状态或另一侧模型',()=>{
  const old=member(),change={kind:'update' as const,memberId:old.memberId,expectedRevision:1,patch:{name:'岗位新名称'},reason:'调整显示名称'},request={...identity,change};
  const update={...preview,change,registryCursor:cursor,previousRevision:1,previousMember:old,proposed:{...preview.proposed,name:'岗位新名称'},changedFields:['name' as const]};
  expect(checkedWorkspaceMemberPreview(update,request)).toEqual(update);
  expect(()=>checkedWorkspaceMemberPreview({...update,proposed:{...update.proposed,state:'suspended'}},request)).toThrow();
  expect(()=>checkedWorkspaceMemberPreview({...update,proposed:{...update.proposed,runtimePolicy:{...policy,configurationHash:hash}}},request)).toThrow();
  expect(()=>checkedWorkspaceMemberPreview({...update,proposed:{...update.proposed,capability:{...update.proposed.capability,configuration:{...configuration,agentId:'.cbim/team/other',source:'workspace'}}}},request)).toThrow();
});

it('实际请求被调用后未知只能查原命令，重建控制器不自动提交且不借新实例替换原身份',async()=>{
  let accepted!:WorkspaceMemberReceipt;const f=fixture({commit:vi.fn(async request=>{accepted=receipt(request);throw Error('IPC_TIMEOUT')}),lookup:vi.fn(async()=>accepted)});
  await f.controller.submit(input,preview);const frozen=f.controller.snapshot.records[0].request;expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  await f.controller.submit({...input,instanceId:randomUUID()},preview);expect(f.ports.commit).toHaveBeenCalledTimes(1);
  const restored=new WorkspaceMemberCommands('workspace',f.ports);await restored.restore();expect(f.ports.commit).toHaveBeenCalledTimes(1);expect(f.ports.lookup).toHaveBeenCalledWith({workspaceId:'workspace',commandId:frozen.commandId});expect(restored.snapshot.records[0].receipt).toEqual(accepted);expect(restored.snapshot.records[0].request).toEqual(frozen);
});

it('空查询或后来的预拒不证明未知未受理，明确重试仍使用原请求',async()=>{
  const commit=vi.fn(async()=>{throw Error('IPC_TIMEOUT')}),f=fixture({commit});await f.controller.submit(input,preview);const record=f.controller.snapshot.records[0];await f.controller.query(record.request.commandId);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  commit.mockImplementation(async()=>{throw Error('MEMBER_BASIS_STALE: 已变化')});await f.controller.retry(record.request.commandId);expect(f.controller.snapshot.records[0].phase).toBe('unknown');expect(commit.mock.calls[0]).toEqual(commit.mock.calls[1]);
  expect(workspaceMemberPreRejected(Error('MEMBER_REGISTRY_STALE: stale'))).toBe(true);for(const code of ['MEMBER_COMMAND_CONFLICT','MEMBER_RECEIPT_INVALID','EIO','MEMBER_NEW_ERROR'])expect(workspaceMemberPreRejected(Error(code+': unknown'))).toBe(false);
  expect(workspaceMemberPreRejected(Error('MEMBER_OWNERSHIP_ACTIVE: 请先解除模块责任'))).toBe(true);
  commit.mockImplementation(async()=>{throw Error('MEMBER_OWNERSHIP_ACTIVE: 仍有模块责任')});await f.controller.retry(record.request.commandId);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  const rejected=fixture({commit:async()=>{throw Error('MEMBER_BASIS_STALE: stale')}});await rejected.controller.submit(input,preview);expect(rejected.controller.snapshot.records[0].phase).toBe('rejected');expect(rejected.controller.blocked).toBe(false);
});

it('坏回包不清除原请求，已受理回执不可被后来的矛盾查询替换',async()=>{
  const f=fixture({commit:async request=>({...receipt(request),basis:modelHash})});await f.controller.submit(input,preview);expect(f.controller.snapshot.records[0].phase).toBe('unknown');
  const g=fixture();await g.controller.submit(input,preview);const before=g.controller.snapshot.records[0];g.ports.lookup=async()=>({...before.receipt,memberId:randomUUID()});await g.controller.query(before.request.commandId);expect(g.controller.snapshot.records[0].phase).toBe('accepted');expect(g.controller.snapshot.records[0].receipt).toEqual(before.receipt);expect(g.controller.snapshot.records[0].error).toContain('查询未确认');
});

it('本机存储故障先阻止发送，受理后保存失败保留事实且只读查询可恢复持久化',async()=>{
  const f=fixture({storage:{getItem:()=>null,setItem:()=>{throw Error('quota')}}});await f.controller.submit(input,preview);expect(f.ports.commit).not.toHaveBeenCalled();expect(f.controller.blocked).toBe(true);
  const saved=new Map<string,string>();let writes=0,accepted!:WorkspaceMemberReceipt;const g=fixture({storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{if(++writes===2)throw Error('quota');saved.set(key,value)}},commit:async request=>(accepted=receipt(request)),lookup:async()=>accepted});await g.controller.submit(input,preview);expect(g.controller.snapshot.records[0].phase).toBe('accepted');expect(g.controller.blocked).toBe(true);await g.controller.query(accepted.commandId);expect(g.controller.blocked).toBe(false);expect(JSON.parse([...saved.values()][0]).records[0].phase).toBe('accepted');
  const broken=fixture({storage:{getItem:()=>'{broken',setItem:()=>{}}});await broken.controller.submit(input,preview);expect(broken.ports.commit).not.toHaveBeenCalled();expect(broken.controller.snapshot.error).toContain('无法读取');
});

it('岗位表单明确模型选择、采纳/退休语义，历史原则作为文本不执行',()=>{
  const html=renderToStaticMarkup(createElement(WorkspaceMemberForm,{kind:'register',agents:[{id:'cbim:executor',name:'默认执行者'}],disabled:false,onEdit:()=>{},onPreview:async()=>{},onClose:()=>{}}));expect(html).toContain('请选择明确的供应商与模型');expect(html).toContain('变更原因');expect(html).toContain('静态 Agent');
  const data=detail(),view=renderToStaticMarkup(createElement(WorkspaceMemberDetailView,{detail:data}));expect(view).toContain('与已采纳一致');expect(view).toContain('不验证密钥或网络');expect(view).toContain('&lt;script&gt;');expect(view).not.toContain('<script>');
});
