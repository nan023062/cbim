/**
 * 作用定位：业务架构和项目岗位共用的模块责任控制面，提供岗位选择、登记入口、预览、明确提交和原命令核实。
 * 设计原因：新项目可从静态 Agent 进入独立岗位登记；返回后只选用重新核实的 active memberId，静态定义不冒充岗位，负责人保存与来源采纳仍各自预览。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ModuleOwnershipIdentity,ModuleOwnershipPage,ModuleOwnershipDetail,ModuleOwnershipPreview,ModuleOwnershipChangeInput,ModuleOwnershipPreviewInput} from '../../bridge/contracts/module-ownership';
import {isModuleOwnershipSourceAdoption} from '../../bridge/contracts/module-ownership';
import type {WorkspaceMemberList} from '../../bridge/contracts/workspace-members';
import {checkedWorkspaceMemberList} from '../team/workspace-member-state';
import {ModuleOwnershipCommandPool,checkedModuleOwnershipPage,checkedModuleOwnershipDetail,checkedModuleOwnershipPreview} from './module-ownership-state';
import {ModuleOwnershipDetailView,ownershipStatus} from './ModuleOwnershipDetail';
import {KnowledgeSourceSelection} from '../knowledge/KnowledgeSourceDetails';
import './module-ownership.css';

const commands=new ModuleOwnershipCommandPool();
const failure=(error:unknown)=>error instanceof Error?error.message:String(error);
/** memberId 只限制反查；initialMemberId 仅在首次打开原模块时尝试选择真实启用岗位，不能授权提交。切换身份须换 key。 */
export interface ModuleOwnershipPanelProps {identity:ModuleOwnershipIdentity;initialModuleId?:string;initialMemberId?:string;memberId?:string;onClose:()=>void;/** 上层组合岗位登记，避免责任面板反向依赖岗位管理组件。 */registration?:{agents:Array<{id:string;name:string}>;onSelect:(moduleId:string,agentId:string)=>void}}
export function ModuleOwnershipPanel({identity,initialModuleId,initialMemberId,memberId,onClose,registration}:ModuleOwnershipPanelProps){
  const controller=useMemo(()=>commands.get(identity.workspaceId,{storage:window.localStorage,uuid:()=>crypto.randomUUID(),commit:input=>window.cbim.call('workspace.ownerships.commit',input),lookup:input=>window.cbim.call('workspace.ownerships.receipt',input)}),[identity.workspaceId]);
  const [,setTick]=useState(0),[page,setPage]=useState<ModuleOwnershipPage>(),[detail,setDetail]=useState<ModuleOwnershipDetail>(),[members,setMembers]=useState<WorkspaceMemberList['items']>([]);
  const [nextId,setNextId]=useState(''),[reason,setReason]=useState(''),[preview,setPreview]=useState<ModuleOwnershipPreview>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[membersLoaded,setMembersLoaded]=useState(false);
  const alive=useRef(false),generation=useRef(0),lock=useRef(false),selection=useRef(0);
  const state=controller.snapshot,blocked=controller.blocked;
  useEffect(()=>{alive.current=true;const unsubscribe=controller.subscribe(()=>setTick(value=>value+1));void controller.restore().then(async()=>{if(!alive.current)return;await list();if(alive.current&&initialModuleId)await select(initialModuleId,initialMemberId)});return()=>{alive.current=false;generation.current++;selection.current++;unsubscribe()}},[controller,identity.instanceId,memberId]);
  async function list(offset=0){
    if(lock.current)return;lock.current=true;const token=++generation.current;setLoading(true);setError('');
    try{const input={...identity,...(memberId?{memberId}:{}),offset,limit:20,...(offset&&page?{expectedReadBasis:page.basis}:{})};const value=checkedModuleOwnershipPage(await window.cbim.call(memberId?'workspace.ownerships.byMember':'workspace.ownerships.list',input),input);if(alive.current&&generation.current===token)setPage(value)}
    catch(cause){if(alive.current&&generation.current===token)setError('责任列表读取失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current&&generation.current===token)setLoading(false)}
  }
  async function currentMembers(){
    const result:WorkspaceMemberList['items']=[];let offset=0,cursor:WorkspaceMemberList['registryCursor']|undefined;
    do{const input={...identity,offset,limit:100,...(offset&&cursor?{expectedRegistryCursor:cursor}:{})};const value=checkedWorkspaceMemberList(await window.cbim.call('workspace.members.list',input),input);result.push(...value.items);cursor=value.registryCursor;if(value.nextOffset===undefined)return result;if(value.nextOffset<=offset||result.length>256)throw Error('岗位分页没有前进或超过范围');offset=value.nextOffset}while(alive.current);
    throw Error('已离开当前视图');
  }
  async function select(moduleId:string,preferredMemberId?:string){
    if(lock.current)return;lock.current=true;const token=++generation.current;selection.current++;setLoading(true);setError('');setPreview(undefined);setDetail(undefined);setMembers([]);setMembersLoaded(false);setReason('');setNextId('');
    try{const input={...identity,moduleId};const value=checkedModuleOwnershipDetail(await window.cbim.call('workspace.ownerships.get',input),input);if(!alive.current||generation.current!==token)return;setDetail(value);setNextId(value.view.binding?.ownerMemberId??'');try{const choices=await currentMembers();if(alive.current&&generation.current===token){setMembers(choices);setMembersLoaded(true);if(preferredMemberId){if(choices.some(item=>item.memberId===preferredMemberId&&item.state==='active'))setNextId(preferredMemberId);else setError('新登记岗位当前不可选，请重新核实岗位状态。')}}}catch(cause){if(alive.current&&generation.current===token)setError('岗位列表无法核实；仍可明确解除现有关系：'+failure(cause))}}
    catch(cause){if(alive.current&&generation.current===token)setError('模块责任读取失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current&&generation.current===token)setLoading(false)}
  }
  function invalidate(){selection.current++;setPreview(undefined)}
  async function prepare(adoptSource=false){
    if(!detail||blocked||lock.current)return;const binding=detail.view.binding,next=members.find(item=>item.memberId===nextId);
    if(adoptSource&&!binding?.ownerMemberId){setError('先设置负责人，再明确采纳新的模块来源');return}
    if(!adoptSource&&nextId&&(!next||next.state!=='active')){setError('请选择当前已启用的项目岗位');return}
    const expectedBinding=binding?{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId}:null;
    // 来源采纳保留原负责人；不能将界面选中的另一个岗位夹带进此命令。
    const change:ModuleOwnershipChangeInput=adoptSource?{kind:'adopt_source',moduleId:detail.view.moduleId,expectedBinding:expectedBinding!,reason}:{moduleId:detail.view.moduleId,expectedBinding,nextOwner:nextId&&next?{memberId:next.memberId,expectedRevision:next.revision}:null,reason};
    const input:ModuleOwnershipPreviewInput={...identity,change};lock.current=true;const token=selection.current;setLoading(true);setError('');setPreview(undefined);
    try{const value=checkedModuleOwnershipPreview(await window.cbim.call('workspace.ownerships.preview',input),input);if(alive.current&&selection.current===token)setPreview(value)}
    catch(cause){if(alive.current&&selection.current===token)setError('负责人变更预览失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current)setLoading(false)}
  }
  async function commit(){
    if(!preview||blocked||lock.current)return;lock.current=true;setLoading(true);await controller.submit({...identity,change:preview.change},preview);lock.current=false;if(!alive.current)return;setLoading(false);setPreview(undefined);
    const record=controller.snapshot.records.at(-1);if(record?.phase==='accepted'){await list();if(alive.current)await select(record.receipt!.moduleId)}else if(record?.error)setError(record.error);
  }
  async function query(commandId:string,retry=false){if(retry)await controller.retry(commandId);else await controller.query(commandId);if(alive.current)await list()}
  const binding=detail?.view.binding,sameOwner=(binding?.ownerMemberId??null)===(nextId||null);
  return <section className="module-ownership" data-testid="module-ownership-panel" aria-label="模块负责人">
    <header><div><p className="overline">工作区 / 模块责任</p><h2>{memberId?'岗位负责的模块':'模块负责人'}</h2></div><button onClick={onClose}>返回架构</button></header>
    <p className="module-ownership-note">一个模块只登记一个负责人岗位。负责人登记与实际执行分开，本次操作不会移交已有任务或启动模型。</p>
    <button data-testid="module-ownership-refresh" disabled={loading} onClick={()=>void list()}>刷新责任列表</button>
    {(error||state.error)&&<p role="alert">{error||state.error}</p>}{loading&&<p role="status">正在核实模块与岗位…</p>}
    <div className="module-ownership-layout"><aside data-testid="module-ownership-list">
      {page?.items.map(view=><button key={view.moduleId} data-testid="module-ownership-row" data-module-id={view.moduleId} aria-pressed={detail?.view.moduleId===view.moduleId} disabled={loading} onClick={()=>void select(view.moduleId)}><strong>{view.module?.name??view.moduleId}</strong><small>{view.owner?.name??'未设置负责人'} · {ownershipStatus(view.status)}</small></button>)}
      {page&&!page.total&&<p>{memberId?'该岗位当前没有负责的模块。':'尚无可见模块或历史责任记录。'}</p>}
      {page&&<div className="module-ownership-paging"><small>共 {page.total} 个</small>{page.offset>0&&<button disabled={loading} onClick={()=>void list()}>回到首页</button>}{page.nextOffset!==undefined&&<button disabled={loading} onClick={()=>void list(page.nextOffset)}>下一页</button>}</div>}
    </aside><div className="module-ownership-body">
      {detail&&<><ModuleOwnershipDetailView detail={detail}/><button disabled={loading} onClick={()=>void select(detail.view.moduleId)}>重新核实模块与岗位</button>
        <form className="module-ownership-form" onSubmit={event=>{event.preventDefault();void prepare()}}><fieldset disabled={blocked||loading}>
          <label>负责人岗位<select aria-label="负责人岗位" value={nextId} onChange={event=>{const value=event.target.value;invalidate();if(value.startsWith('agent:')){registration?.onSelect(detail.view.moduleId,value.slice(6));return}setNextId(value)}}><option value="">不设置负责人 / 解除</option>{members.map(member=><option key={member.memberId} value={member.memberId} disabled={member.state!=='active'}>{member.name} · 第 {member.revision} 版{member.state!=='active'?' · '+(member.state==='suspended'?'已暂停':'已退休'):''}</option>)}{nextId&&!members.some(member=>member.memberId===nextId)&&<option value={nextId} disabled>原负责人暂不可选</option>}{membersLoaded&&registration&&<optgroup label="从 Agent 登记新岗位">{registration.agents.map(agent=><option key={agent.id} value={'agent:'+agent.id}>{agent.name} · 登记项目岗位…</option>)}</optgroup>}</select></label>
          {membersLoaded&&!members.some(member=>member.state==='active')&&<p data-testid="module-ownership-no-members" role="status">{members.length?'当前没有已启用的项目岗位。':'当前项目尚未登记岗位。'}{registration?.agents.length?'请在上方选择 Agent，明确岗位与模型并保存；返回后再确认模块负责人。':'请先在团队架构的“项目岗位”中登记或启用岗位，再重新核实列表。'}</p>}
          <label>变更原因<textarea aria-label="负责人变更原因" required maxLength={2000} value={reason} onChange={event=>{setReason(event.target.value);invalidate()}}/></label>
          <button data-testid="module-ownership-preview" type="submit" disabled={sameOwner||!reason.trim()}>预览负责人变更</button>
          {binding?.ownerMemberId&&<button data-testid="module-ownership-adopt-source" type="button" disabled={!sameOwner||!reason.trim()} onClick={()=>void prepare(true)}>预览采纳当前来源</button>}
        </fieldset></form>
      </>}
      {!detail&&!loading&&<p>选择模块查看或修改负责人。</p>}
      {preview&&<section className="module-ownership-preview" data-testid="module-ownership-preview-result"><h3>{isModuleOwnershipSourceAdoption(preview.change)?'来源采纳预览':'负责人变更预览'}</h3><KnowledgeSourceSelection selection={preview.sourceSelection}/><p>{preview.previousOwner?.name??'未设置'} → <strong>{preview.nextOwner?.name??'解除负责人'}</strong></p><p>{preview.change.reason}</p><p>关联任务 {preview.impact.total} 个：未领取 {preview.impact.counts.unclaimed}、执行中 {preview.impact.counts.inFlight}、检查点 {preview.impact.counts.checkpointed}、已终结 {preview.impact.counts.terminal}、其他 {preview.impact.counts.other}。此次登记不会改变这些任务。</p>{preview.issues.map((issue,index)=><p key={index}>{issue.message}</p>)}<button data-testid="module-ownership-commit" disabled={blocked||loading} onClick={()=>void commit()}>{isModuleOwnershipSourceAdoption(preview.change)?'确认采纳当前来源':'确认保存负责人'}</button></section>}
    </div></div>
    {!!state.records.length&&<details className="module-ownership-commands" open={blocked}><summary>本机责任提交记录 · {state.records.length}</summary>{[...state.records].reverse().map(record=><div key={record.request.commandId} data-command-id={record.request.commandId}><strong>{{submitting:'正在提交',unknown:'结果未确认',accepted:'已受理',rejected:'未受理'}[record.phase]}</strong><code>{record.request.commandId}</code>{record.error&&<p role="alert">{record.error}</p>}{record.receipt&&<p>{record.receipt.moduleId} · 责任第 {record.receipt.revision} 版</p>}{record.phase!=='rejected'&&<button data-testid="module-ownership-receipt-query" disabled={controller.isPending(record.request.commandId)} onClick={()=>void query(record.request.commandId)}>查询原命令</button>}{record.phase==='unknown'&&<button disabled={controller.isPending(record.request.commandId)} onClick={()=>void query(record.request.commandId,true)}>重送同一请求</button>}{record.receipt&&<button disabled={loading} onClick={()=>void select(record.receipt!.moduleId)}>查看模块责任</button>}</div>)}</details>}
  </section>;
}
