/**
 * 作用定位：编辑当前工作区自动化，Agent/模块/Workflow/Skill 来自后端有效目录。
 * 设计原因：表单只保存显式配置，不启动模型；权限独立可见，日程固定时区，草稿不随后台轮询覆盖。
 */
import {useState} from 'react';
import type {AutomationCatalog,AutomationDefinition,AutomationSchedule} from '../../bridge/contracts/automation';

export function AutomationEditor({initial,catalog,busy,onSave,onCancel}:{initial:AutomationDefinition;catalog:AutomationCatalog;busy:boolean;onSave:(value:AutomationDefinition)=>void;onCancel:()=>void}){
 const [value,setValue]=useState(initial),[error,setError]=useState('');
 const patch=(part:Partial<AutomationDefinition>)=>setValue(old=>({...old,...part}));
 const executor=value.executor,agentId=executor.kind==='main'?'cbim:main':catalog.agents.find(a=>a.memberId===executor.memberId)?.agentId;
 const skills=catalog.skills.filter(s=>s.agentIds.includes(agentId??'')),schedule=value.schedule;
 function setSchedule(kind:AutomationSchedule['kind']){
  patch({schedule:kind==='manual'?{kind}:kind==='interval'?{kind,minutes:60}:kind==='daily'?{kind,time:'09:00',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}:{kind,at:new Date(Date.now()+3600000).toISOString()}});
 }
 function submit(){
  if(!value.name.trim()||!value.prompt.trim()){setError('请填写任务名称和提示上下文');return}
  if(value.executor.kind==='member'&&!value.moduleIds.length){setError('团队岗位执行需要至少选择一个模块');return}
  setError('');onSave(value);
 }
 const localOnce=schedule.kind==='once'?new Date(Date.parse(schedule.at)-new Date(schedule.at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
 return <form className="automation-editor" onSubmit={e=>{e.preventDefault();submit()}}>
  <h2>自动化设置</h2><p>绑定当前工作区。默认 Agent 使用主 Agent 设置；团队岗位使用其已采纳的引擎和模型。</p>
  <fieldset disabled={busy}>
   <label>任务名称<input value={value.name} maxLength={120} required onChange={e=>patch({name:e.target.value})}/></label>
   <label>执行 Agent<select value={executor.kind==='main'?'main':executor.memberId} onChange={e=>patch({executor:e.target.value==='main'?{kind:'main'}:{kind:'member',memberId:e.target.value},skillIds:[]})}><option value="main">默认 Agent（主 Agent）</option>{catalog.agents.map(agent=><option key={agent.memberId} value={agent.memberId}>{agent.name}</option>)}</select></label>
   <fieldset><legend>作业范围（模块）</legend>{catalog.modules.length?catalog.modules.map(module=><div className="automation-module" key={module.id}>
    <label className="automation-check"><input type="checkbox" checked={value.moduleIds.includes(module.id)} onChange={e=>patch({moduleIds:e.target.checked?[...value.moduleIds,module.id]:value.moduleIds.filter(id=>id!==module.id),workflowSelections:value.workflowSelections.filter(w=>w.moduleId!==module.id)})}/><span>{module.name}<small>{module.id}</small></span></label>
    {value.moduleIds.includes(module.id)&&<label>Workflow<select value={value.workflowSelections.find(w=>w.moduleId===module.id)?.workflowId??''} onChange={e=>patch({workflowSelections:[...value.workflowSelections.filter(w=>w.moduleId!==module.id),...(e.target.value?[{moduleId:module.id,workflowId:e.target.value}]:[])]})}><option value="">沿用模块默认流程</option>{module.workflows.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
   </div>):<p>尚无有效模块。默认 Agent 可在当前工作区执行。</p>}</fieldset>
   <fieldset><legend>Skill</legend>{skills.map(skill=><label className="automation-check" key={skill.id}><input type="checkbox" checked={value.skillIds.includes(skill.id)} onChange={e=>patch({skillIds:e.target.checked?[...value.skillIds,skill.id]:value.skillIds.filter(id=>id!==skill.id)})}/>{skill.name}</label>)}{!skills.length&&<p>此岗位暂无可选 Skill。</p>}</fieldset>
   <label>提示上下文<textarea value={value.prompt} required rows={6} maxLength={16000} placeholder="描述要执行的工作、约束和可核实的完成标准" onChange={e=>patch({prompt:e.target.value})}/></label>
   <label>执行权限<select value={value.permission} onChange={e=>patch({permission:e.target.value as AutomationDefinition['permission']})}><option value="read">只读</option><option value="ask">写入前请求批准</option><option value="execute">允许执行和写入</option></select></label><p>请求批准或需要补充时，在对应会话处理。</p>
   <label>执行计划<select value={schedule.kind} onChange={e=>setSchedule(e.target.value as AutomationSchedule['kind'])}><option value="manual">仅手动运行</option><option value="interval">固定间隔</option><option value="daily">每天</option><option value="once">指定时间执行一次</option></select></label>
   {schedule.kind==='interval'&&<label>间隔（分钟）<input type="number" min={1} max={525600} required value={schedule.minutes} onChange={e=>patch({schedule:{...schedule,minutes:Number(e.target.value)}})}/></label>}
   {schedule.kind==='daily'&&<><label>每天时间<input type="time" required value={schedule.time} onChange={e=>patch({schedule:{...schedule,time:e.target.value}})}/></label><p>时区：{schedule.timezone}</p></>}
   {schedule.kind==='once'&&<label>本地时间<input type="datetime-local" required value={localOnce} onChange={e=>{const date=new Date(e.target.value);if(Number.isFinite(date.getTime()))patch({schedule:{...schedule,at:date.toISOString()}})}}/></label>}
   <label className="automation-check"><input type="checkbox" checked={value.enabled} onChange={e=>patch({enabled:e.target.checked})}/>启用计划</label>
  </fieldset>
  {error&&<p role="alert">{error}</p>}<div className="automation-actions"><button type="submit" disabled={busy}>保存任务</button><button type="button" disabled={busy} onClick={onCancel}>取消</button></div>
 </form>;
}
