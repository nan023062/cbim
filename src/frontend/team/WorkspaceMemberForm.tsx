/**
 * 作用定位：项目岗位登记、元信息编辑、明确采纳及状态变更的表单。
 * 设计原因：模型必须明确选择；编辑名称不顺带采纳能力或重写模型，所有选择先交 Main 预览，界面不拼造采纳正文和操作者。
 */
import {useState} from 'react';
import type {LlmSettings} from '../../bridge/contracts/models';
import {workspaceMemberChangeInputSchema} from '../../bridge/contracts/workspace-members';
import type {WorkspaceMember,WorkspaceMemberChangeInput} from '../../bridge/contracts/workspace-members';

/** onPreview 只表达人工选择，成员 revision 固定为打开表单时读到的版本。 */
export interface WorkspaceMemberFormProps {kind:WorkspaceMemberChangeInput['kind'];member?:WorkspaceMember;agents:Array<{id:string;name:string}>;models?:LlmSettings;target?:'capability'|'model';nextState?:'active'|'suspended'|'retired';disabled:boolean;onEdit:()=>void;onPreview:(change:WorkspaceMemberChangeInput)=>Promise<void>;onClose:()=>void}
export function WorkspaceMemberForm({kind,member,agents,models,target,nextState,disabled,onEdit,onPreview,onClose}:WorkspaceMemberFormProps){
  const register=kind==='register',editable=register||kind==='update';
  const [name,setName]=useState(register?'':member?.name??''),[position,setPosition]=useState(register?'':member?.position??''),[instructions,setInstructions]=useState(register?'':member?.adaptation.instructions??'');
  const [references,setReferences]=useState(register?'':member?.adaptation.references.join('\n')??''),[agent,setAgent]=useState(''),[model,setModel]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  const change=(fn:()=>void)=>{onEdit();setError('');fn()};
  async function prepare(){try{
    const runtimePolicy=model?(()=>{const [profileId,modelId]=JSON.parse(model);return {profileId,modelId}})():undefined;
    const adaptation={instructions,references:references.split('\n').map(line=>line.trim()).filter(Boolean)};
    let input:unknown;
    if(register){if(!runtimePolicy)throw Error('请明确选择岗位模型');input={kind,agentId:agent,name,position,adaptation,runtimePolicy,reason}}
    else{if(!member)throw Error('请先读取岗位');const base={kind,memberId:member.memberId,expectedRevision:member.revision,reason};if(kind==='update')input={...base,patch:{...(name!==member.name?{name}:{}),...(position!==member.position?{position}:{}),...(JSON.stringify(adaptation)!==JSON.stringify(member.adaptation)?{adaptation}:{}),...(runtimePolicy?{runtimePolicy}:{})}};else if(kind==='adopt')input={...base,target};else input={...base,nextState}}
    await onPreview(workspaceMemberChangeInputSchema.parse(input));
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}
  return <form className="workspace-member-form" onSubmit={event=>{event.preventDefault();void prepare()}}><h3>{register?'登记项目岗位':kind==='update'?'修改岗位':kind==='adopt'?'明确采纳新版本':nextState==='retired'?'退休岗位':nextState==='suspended'?'暂停岗位':'启用岗位'}</h3>
    <fieldset disabled={disabled}>
      {register&&<label>静态 Agent<select aria-label="静态 Agent" value={agent} onChange={event=>change(()=>setAgent(event.target.value))}><option value="">请选择专业能力</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {editable&&<><label>岗位名称<input aria-label="岗位名称" value={name} maxLength={100} onChange={event=>change(()=>setName(event.target.value))}/></label><label>岗位职责<textarea aria-label="岗位职责" value={position} maxLength={500} onChange={event=>change(()=>setPosition(event.target.value))}/></label><label>岗位适配说明<textarea aria-label="岗位适配说明" value={instructions} maxLength={8000} onChange={event=>change(()=>setInstructions(event.target.value))}/></label><label>参考知识 ID（每行一项）<textarea aria-label="参考知识 ID" value={references} onChange={event=>change(()=>setReferences(event.target.value))}/></label>
        <label>岗位模型<select aria-label="岗位模型" value={model} onChange={event=>change(()=>setModel(event.target.value))}><option value="">{register?'请选择明确的供应商与模型':'保留已采纳模型配置'}</option>{models?.profiles.flatMap(profile=>profile.models.filter(item=>item.enabled).map(item=><option key={JSON.stringify([profile.id,item.id])} value={JSON.stringify([profile.id,item.id])}>{profile.name} / {item.name||item.id}</option>))}</select></label><p>模型配置修改不会自动影响已采纳岗位。同一模型的新配置请使用“采纳当前模型配置”。</p></>}
      {kind==='adopt'&&<p>仅重新采纳{target==='capability'?'原静态 Agent 的工作原则及可用 Skill':'当前岗位已选择的供应商/模型配置'}，另一侧保持原版本。</p>}
      {kind==='state'&&<p>{nextState==='retired'?'退休后不能恢复或复用此岗位身份；历史记录保留。':'只改变登记状态，不启动或停止现有任务；能力和模型当前差异仍需单独核实。'}</p>}
      <label>变更原因<textarea aria-label="变更原因" value={reason} maxLength={2000} onChange={event=>change(()=>setReason(event.target.value))}/></label>
      <button type="submit" data-testid="workspace-member-preview">预览变更</button>
    </fieldset>{error&&<p role="alert">{error}</p>}<button type="button" disabled={disabled} onClick={onClose}>取消编辑</button>
  </form>;
}
