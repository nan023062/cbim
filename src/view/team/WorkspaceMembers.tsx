/**
 * 作用定位：团队与业务架构共用的项目岗位登记面板，浏览采纳差异、显式变更，并反查负责的模块。
 * 设计原因：登记始终复用同一命令记录与预览校验；业务架构可预选 Agent，只有真实登记受理后才返回 memberId，模型与责任仍分别明确选择和保存。
 * 登记预览展示实际采纳的引擎及模型，候选 Agent 的本机默认选型只传入新登记表单。
 */
import {engineLabel} from '../../bridge/contracts/models';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {LlmSettings} from '../../bridge/contracts/models';
import {workspaceMemberPreviewInputSchema} from '../../bridge/contracts/workspace-members';
import type {WorkspaceMemberChangeInput,WorkspaceMemberDetail,WorkspaceMemberList,WorkspaceMemberPreview,WorkspaceMemberPreviewInput} from '../../bridge/contracts/workspace-members';
import {workspaceMemberCommands as commands,checkedWorkspaceMemberDetail,checkedWorkspaceMemberList,checkedWorkspaceMemberPreview} from './workspace-member-state';
import {WorkspaceMemberForm} from './WorkspaceMemberForm';
import {WorkspaceMemberDetailView} from './WorkspaceMemberDetail';
import {ModuleOwnershipPanel} from '../workspace/ModuleOwnershipPanel';
import {KnowledgeSourceSelection} from '../knowledge/KnowledgeSourceDetails';
import './workspace-members.css';

const failure=(error:unknown)=>error instanceof Error?error.message:String(error);
export interface WorkspaceMemberAgentOption {id:string;name:string;runtime?:import('../../bridge/contracts/models').AgentModelSelection}
/** 当前定义只用于明确选择；已登记岗位的正文和版本一律从后端详情读取，不用静态列表补造。 */
export interface WorkspaceMembersProps {workspace:WorkspaceView;agents:WorkspaceMemberAgentOption[];onClose:()=>void;/** 仅预选能力来源，不自动选模型、预览或提交。 */initialRegistration?:{agentId:string};/** 只通知本次已受理的登记，不把预览、未知或旧命令查询当作新岗位。 */onRegistered?:(memberId:string)=>void;returnLabel?:string}
export function WorkspaceMembers({workspace,agents,onClose,initialRegistration,onRegistered,returnLabel='返回团队定义'}:WorkspaceMembersProps){
  const controller=useMemo(()=>commands.get(workspace.id,{storage:window.localStorage,uuid:()=>crypto.randomUUID(),commit:input=>window.cbim.call('workspace.members.commit',input),lookup:input=>window.cbim.call('workspace.members.receipt',input)}),[workspace.id]);
  const [tick,setTick]=useState(0),[page,setPage]=useState<WorkspaceMemberList>(),[detail,setDetail]=useState<WorkspaceMemberDetail>(),[models,setModels]=useState<LlmSettings>();
  const [editing,setEditing]=useState<WorkspaceMemberChangeInput['kind']|undefined>(initialRegistration?'register':undefined),[special,setSpecial]=useState<{target?:'capability'|'model';nextState?:'active'|'suspended'|'retired'}>({});
  const [preview,setPreview]=useState<WorkspaceMemberPreview>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [ownershipMember,setOwnershipMember]=useState<string>();
  const alive=useRef(false),epoch=useRef(0),lock=useRef(false),selection=useRef(0);
  const identity={workspaceId:workspace.id,instanceId:workspace.instanceId??''};
  const state=controller.snapshot,blocked=controller.blocked,available=workspace.state==='running'&&!!workspace.instanceId;
  useEffect(()=>{alive.current=true;const unsubscribe=controller.subscribe(()=>setTick(value=>value+1));void controller.restore().then(()=>{if(alive.current)void list()});return()=>{alive.current=false;epoch.current++;selection.current++;unsubscribe()}},[controller,workspace.instanceId]);
  useEffect(()=>{let gone=false;void window.cbim.call('models.list').then(value=>{if(!gone)setModels(value)}).catch(cause=>{if(!gone)setError('模型配置读取失败：'+failure(cause))});return()=>{gone=true}},[workspace.id]);
  async function list(next?:number){
    if(!available||lock.current)return;lock.current=true;const token=++epoch.current;setLoading(true);setError('');
    try{const input={...identity,offset:next??0,limit:20,...(next&&page?.registryCursor?{expectedRegistryCursor:page.registryCursor}:{})};const result=checkedWorkspaceMemberList(await window.cbim.call('workspace.members.list',input),input);if(alive.current&&epoch.current===token)setPage(result)}
    catch(cause){if(alive.current&&epoch.current===token)setError('岗位列表读取失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current&&epoch.current===token)setLoading(false)}
  }
  async function select(memberId:string){
    if(!available||lock.current)return;lock.current=true;const token=++epoch.current;selection.current++;setEditing(undefined);setPreview(undefined);setDetail(undefined);setLoading(true);setError('');
    try{const input={...identity,memberId};const result=checkedWorkspaceMemberDetail(await window.cbim.call('workspace.members.get',input),input);if(alive.current&&epoch.current===token)setDetail(result)}
    catch(cause){if(alive.current&&epoch.current===token)setError('岗位详情读取失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current&&epoch.current===token)setLoading(false)}
  }
  function start(kind:WorkspaceMemberChangeInput['kind'],extra:typeof special={}){selection.current++;setEditing(kind);setSpecial(extra);setPreview(undefined);setError('')}
  function invalidate(){selection.current++;setPreview(undefined)}
  async function prepare(change:WorkspaceMemberChangeInput){
    if(!available||blocked||lock.current)return;lock.current=true;const generation=selection.current;setLoading(true);setError('');setPreview(undefined);
    try{const input=workspaceMemberPreviewInputSchema.parse({...identity,change});const result=checkedWorkspaceMemberPreview(await window.cbim.call('workspace.members.preview',input),input);if(alive.current&&selection.current===generation)setPreview(result)}
    catch(cause){if(alive.current&&selection.current===generation)setError('岗位预览失败：'+failure(cause))}
    finally{lock.current=false;if(alive.current)setLoading(false)}
  }
  async function commit(){
    if(!preview||blocked||lock.current)return;lock.current=true;setLoading(true);const input:WorkspaceMemberPreviewInput={...identity,change:preview.change};
    await controller.submit(input,preview);lock.current=false;if(!alive.current)return;setLoading(false);setPreview(undefined);
    const record=controller.snapshot.records.at(-1);if(record?.phase==='accepted'){setEditing(undefined);if(record.request.change.kind==='register'&&onRegistered){onRegistered(record.receipt!.memberId);return}await list();if(alive.current)await select(record.receipt!.memberId)}else if(record?.error)setError(record.error);
  }
  async function query(commandId:string,retry=false){if(retry)await controller.retry(commandId);else await controller.query(commandId);if(alive.current)await list()}
  if(ownershipMember)return <ModuleOwnershipPanel key={workspace.id+workspace.instanceId+ownershipMember} identity={identity} memberId={ownershipMember} onClose={()=>{setOwnershipMember(undefined);void select(ownershipMember)}}/>;
  return <section className="workspace-members" data-testid="workspace-members" aria-label="项目岗位成员">
    <header><div><p className="overline">工作区 / 稳定岗位</p><h2>项目岗位</h2></div><button onClick={onClose}>{returnLabel}</button></header>
    <p className="workspace-member-note">静态 Agent 提供专业能力，岗位保存本项目采纳的能力和模型。新业务由主 Agent 按模块负责人派发；岗位启用本身不代表正在运行，能力来源、模型和责任版本仍须通过领取核实。</p>
    <div className="team-definition-actions"><button data-testid="workspace-member-register" disabled={!available||blocked||loading} onClick={()=>start('register')}>登记项目岗位</button><button disabled={loading} onClick={()=>void list()}>刷新岗位列表</button></div>
    {(error||state.error)&&<p role="alert">{error||state.error}</p>}
    {loading&&<p role="status">正在核实岗位资料…</p>}
    <div className="workspace-member-layout"><aside data-testid="workspace-member-list" aria-label="项目岗位列表">
      {page?.items.map(member=><button key={member.memberId} data-testid="workspace-member-row" data-member-id={member.memberId} aria-pressed={detail?.member.memberId===member.memberId} disabled={loading} onClick={()=>void select(member.memberId)}><strong>{member.name}</strong><span>{member.position}</span><small>{stateLabel(member.state)} · 第 {member.revision} 版</small></button>)}
      {page&&!page.total&&<p>还没有项目岗位。登记不会自动创建任务。</p>}
      {page&&<div className="workspace-member-paging"><small>共 {page.total} 个（含退休）</small>{page.offset>0&&<button disabled={loading} onClick={()=>void list()}>回到首页</button>}{page.nextOffset!==undefined&&<button disabled={loading} onClick={()=>void list(page.nextOffset)}>下一页</button>}</div>}
    </aside><div className="workspace-member-body">
      {detail&&!editing&&<><WorkspaceMemberDetailView detail={detail}/><div className="team-definition-actions"><button disabled={loading} onClick={()=>void select(detail.member.memberId)}>重新核实当前差异</button><button data-testid="workspace-member-ownerships" disabled={loading} onClick={()=>setOwnershipMember(detail.member.memberId)}>负责的模块</button>{detail.member.state!=='retired'&&<>
        <button data-testid="workspace-member-edit" disabled={blocked||loading} onClick={()=>start('update')}>修改岗位</button>
        <button data-testid="workspace-member-adopt-capability" disabled={blocked||loading} onClick={()=>start('adopt',{target:'capability'})}>采纳当前能力</button>
        <button data-testid="workspace-member-adopt-model" disabled={blocked||loading} onClick={()=>start('adopt',{target:'model'})}>采纳当前模型配置</button>
        <button data-testid={detail.member.state==='active'?'workspace-member-suspend':'workspace-member-activate'} disabled={blocked||loading} onClick={()=>start('state',{nextState:detail.member.state==='active'?'suspended':'active'})}>{detail.member.state==='active'?'暂停岗位':'启用岗位'}</button>
        <button data-testid="workspace-member-retire" disabled={blocked||loading} onClick={()=>start('state',{nextState:'retired'})}>退休岗位</button>
      </>}</div></>}
      {editing&&<WorkspaceMemberForm key={JSON.stringify([editing,special,detail?.member.memberId,detail?.member.revision])} kind={editing} member={detail?.member} agents={agents} initialAgentId={initialRegistration?.agentId} models={models} {...special} disabled={blocked||loading} onEdit={invalidate} onPreview={prepare} onClose={()=>{invalidate();setEditing(undefined)}}/>}
      {!detail&&!editing&&!loading&&<p>选择岗位查看已采纳配置和当前差异，或登记新的岗位。</p>}
      {preview&&<section className="workspace-member-preview" data-testid="workspace-member-preview-result"><h3>提交预览</h3><p>变更：{preview.changedFields.join('、')}；原第 {preview.previousRevision} 版 → 第 {preview.previousRevision+1} 版。</p><p>{preview.proposed.name} · {preview.proposed.position} · {stateLabel(preview.proposed.state)}</p><p>能力：{preview.proposed.capability.configuration.name}；{preview.proposed.capability.configuration.effectiveSkills.length} 项 Skill</p><p>模型：{engineLabel(preview.proposed.runtimePolicy.snapshot.engine??'pi')} · {preview.proposed.runtimePolicy.snapshot.name} / {preview.proposed.runtimePolicy.modelId}</p><KnowledgeSourceSelection selection={preview.sourceSelection}/><details><summary>查看实际采纳内容与差异</summary><pre>{JSON.stringify({before:preview.previousMember,after:preview.proposed},null,2)}</pre></details><p>只保存岗位登记与审计，不启动模型或任务。</p><button data-testid="workspace-member-commit" disabled={blocked||loading} onClick={()=>void commit()}>确认保存岗位</button></section>}
    </div></div>
    {!!state.records.length&&<details className="workspace-member-commands" open={blocked}><summary>本机提交记录 · {state.records.length}</summary>{[...state.records].reverse().map(record=><div key={record.request.commandId} data-command-id={record.request.commandId}><strong>{{submitting:'正在提交',unknown:'结果未确认',accepted:'已受理',rejected:'未受理'}[record.phase]}</strong><code>{record.request.commandId}</code>{record.error&&<p role="alert">{record.error}</p>}{record.receipt&&<p>岗位 {record.receipt.memberId} · 第 {record.receipt.memberRevision} 版</p>}{record.phase!=='rejected'&&<button data-testid="workspace-member-receipt-query" disabled={controller.isPending(record.request.commandId)} onClick={()=>void query(record.request.commandId)}>查询原命令</button>}{record.phase==='unknown'&&<button disabled={controller.isPending(record.request.commandId)} onClick={()=>void query(record.request.commandId,true)}>重送同一请求</button>}{record.receipt&&<button disabled={loading} onClick={()=>void select(record.receipt!.memberId)}>查看岗位</button>}</div>)}</details>}
  </section>;
}
function stateLabel(state:'active'|'suspended'|'retired'){return {active:'已启用',suspended:'已暂停',retired:'已退休'}[state]}
