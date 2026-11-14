import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {KnowledgeSourceDetails,KnowledgeSourceSelection} from '../src/view/knowledge/KnowledgeSourceDetails';
import type {KnowledgeSourceRef} from '../src/bridge/contracts/knowledge-source';
import type {ModuleOwnershipCommitInput,ModuleOwnershipPreview,ModuleOwnershipReceipt} from '../src/bridge/contracts/module-ownership';
import {checkedModuleOwnershipPreview,checkedModuleOwnershipReceipt,ModuleOwnershipCommands,moduleOwnershipPreRejected} from '../src/view/workspace/module-ownership-state';
import {workspaceMemberPreRejected} from '../src/view/team/workspace-member-state';

const workspaceId='workspace',instanceId=randomUUID(),moduleId='.cbim/workspace/game',hash='a'.repeat(64),time='2026-11-07T14:00:00.000Z';
const source={kind:'module' as const,sourceId:moduleId};
const ref=():KnowledgeSourceRef=>({version:1,workspaceId,source,generationId:randomUUID()});

it('未追踪和旧缺省显示明确限制，预览不制造已存在代次',()=>{
  const observation={knowledgeRevision:hash,definitionHash:hash,visible:true as const};
  const untracked=renderToStaticMarkup(createElement(KnowledgeSourceDetails,{state:{status:'untracked',source,observation}}));
  expect(untracked).toContain('尚未追踪来源');expect(untracked).toContain('读取页面不会自动补齐');expect(untracked).not.toContain('已绑定当前来源');
  const selection=renderToStaticMarkup(createElement(KnowledgeSourceSelection,{selection:{kind:'workspace',workspaceId,source,expectedRef:null,observation}}));
  expect(selection).toContain('保存时建立本次观察的起点');expect(selection).not.toContain('来源代次：');
  const old=renderToStaticMarkup(createElement(KnowledgeSourceDetails,{}));expect(old).toContain('尚未核实来源身份');
});

it('来源退役保留旧引用，未决不呈现可执行或允许采纳，资料按文本显示',()=>{
  const before=ref(),current=ref();
  const html=renderToStaticMarkup(createElement(KnowledgeSourceDetails,{adopted:before,state:{status:'retired',ref:before,currentRef:current}}));
  expect(html).toContain(before.generationId);expect(html).toContain(current.generationId);expect(html).toContain('不会自动接替原对象');
  const pending=renderToStaticMarkup(createElement(KnowledgeSourceDetails,{adopted:before,state:{status:'pending',transitionId:'source-transition'}}));expect(pending).toContain('暂停新的来源采纳');expect(pending).not.toContain('已绑定当前来源');
  const broken=renderToStaticMarkup(createElement(KnowledgeSourceDetails,{state:{status:'unverifiable',issue:'<script>bad</script>'}}));expect(broken).toContain('&lt;script&gt;');expect(broken).not.toContain('<script>');
});

function adoption(){
  const identity={workspaceId,instanceId},memberId=randomUUID(),bindingId=randomUUID(),streamId=randomUUID(),oldRef=ref(),nextRef=ref();
  const owner={memberId,revision:1,name:'岗位',position:'实现模块',state:'active' as const,agentId:'cbim:executor',teamId:'.cbim/team',profileId:randomUUID(),modelId:'model',createdAt:time,updatedAt:time};
  const expectedBinding={bindingId,revision:1,ownerMemberId:memberId};
  const change={kind:'adopt_source' as const,moduleId,expectedBinding,reason:'明确核对替换后的模块'};
  const request:ModuleOwnershipCommitInput={...identity,change,commandId:randomUUID(),expectedOwnershipCursor:{kind:'module_ownership',workspaceId,streamId,seq:1},expectedBasis:hash};
  const preview:ModuleOwnershipPreview={identity,readOnly:true,change,ownershipCursor:request.expectedOwnershipCursor,basis:hash,checkedAt:time,previous:{workspaceId,bindingId,moduleId,revision:1,ownerMemberId:memberId,sourceRef:oldRef,observedModule:{knowledgeRevision:hash,definitionHash:hash,observedAt:time},createdAt:time,updatedAt:time,lastChangeId:randomUUID()},previousOwner:owner,nextOwner:owner,observedModule:{knowledgeRevision:hash,definitionHash:hash,observedAt:time},sourceSelection:{kind:'workspace',workspaceId,source,expectedRef:nextRef,observation:{knowledgeRevision:hash,definitionHash:hash,visible:true}},impact:{coverage:'dispatch_graph_tasks_with_module',total:0,counts:{unclaimed:0,inFlight:0,checkpointed:0,terminal:0,other:0},digest:hash},issues:[]};
  const receipt:ModuleOwnershipReceipt={identity,commandId:request.commandId,action:'adopt_source',actor:{kind:'local_desktop',interaction:'explicit_submit'},changeId:randomUUID(),moduleId,bindingId,previousRevision:1,revision:2,previousOwnerMemberId:memberId,ownerMemberId:memberId,ownershipCursor:{kind:'module_ownership',workspaceId,streamId,seq:2},basis:hash,bindingHash:hash,committedAt:time};
  return {request,preview,receipt};
}

it('同负责人来源采纳必须绑定原版本，不能夹带换人或变造受理回执',()=>{
  const f=adoption();expect(checkedModuleOwnershipPreview(f.preview,f.request)).toEqual(f.preview);expect(checkedModuleOwnershipReceipt(f.receipt,f.request)).toEqual(f.receipt);
  expect(()=>checkedModuleOwnershipPreview({...f.preview,nextOwner:{...f.preview.nextOwner!,memberId:randomUUID()}},f.request)).toThrow();
  for(const bad of [{...f.receipt,action:'replace'},{...f.receipt,ownerMemberId:randomUUID()},{...f.receipt,bindingId:randomUUID()}])expect(()=>checkedModuleOwnershipReceipt(bad,f.request)).toThrow();
});

it('来源采纳回复丢失后保存原请求，重建只查询，不再建立来源或升版',async()=>{
  const f=adoption(),saved=new Map<string,string>(),commit=vi.fn(async()=>{throw Error('IPC_TIMEOUT')}),lookup=vi.fn(async()=>f.receipt);
  const ports={storage:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value)}},commit,lookup,uuid:()=>f.request.commandId};
  const first=new ModuleOwnershipCommands(workspaceId,ports);await first.submit(f.request,f.preview);expect(first.snapshot.records[0].phase).toBe('unknown');
  const restored=new ModuleOwnershipCommands(workspaceId,ports);await restored.restore();expect(commit).toHaveBeenCalledTimes(1);expect(lookup).toHaveBeenCalledWith({workspaceId,commandId:f.request.commandId});expect(restored.snapshot.records[0].request).toEqual(f.request);expect(restored.snapshot.records[0].receipt).toEqual(f.receipt);
});

it('首次来源屏障拒绝可回到编辑，提交结果曾未知后同错误不能解锁新命令',async()=>{
  expect(moduleOwnershipPreRejected(Error('OWNERSHIP_SOURCE_PENDING: 未开始'))).toBe(true);
  expect(workspaceMemberPreRejected(Error('MEMBER_SOURCE_PENDING: 未开始'))).toBe(true);
  for(const code of ['SOURCE_FINAL_PENDING','SOURCE_UNKNOWN','SOURCE_JOURNAL_INVALID']){expect(moduleOwnershipPreRejected(Error(code+': 保留原请求'))).toBe(false);expect(workspaceMemberPreRejected(Error(code+': 保留原请求'))).toBe(false)}
  const f=adoption(),saved=new Map<string,string>(),commit=vi.fn(async()=>{throw Error('IPC_TIMEOUT')});
  const c=new ModuleOwnershipCommands(workspaceId,{storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},commit,lookup:async()=>undefined,uuid:()=>f.request.commandId});
  await c.submit(f.request,f.preview);commit.mockImplementation(async()=>{throw Error('OWNERSHIP_SOURCE_PENDING: 当前未开始')});await c.retry(f.request.commandId);
  expect(c.snapshot.records[0].phase).toBe('unknown');expect(c.blocked).toBe(true);expect(commit.mock.calls[0]).toEqual(commit.mock.calls[1]);
});
