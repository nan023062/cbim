/**
 * 作用定位：Agent 编辑和岗位登记共用的引擎/模型级联下拉菜单。
 * 设计原因：与后端共用供应商接口解析，兼容端点及模型范围共同决定可选项；区分未配置、协议不兼容和模型禁用，列表不触发联网。同引擎更换主模型保留额外角色；更换引擎清空旧选型。
 */
import {useState} from 'react';
import {providerSupportsEngine,engineDescriptor,modelRoleChoices,engineLabel,loopEngineSchema,type LoopEngine} from '../../bridge/contracts/engines';
import {type AgentModelSelection} from '../../bridge/contracts/agent-settings';
import {type LlmSettings} from '../../bridge/contracts/models';

export function EngineModelPicker({models,value,onChange,required=false,emptyLabel='使用本机默认配置',initialEngine,modelLabel='Agent 模型'}:{models?:LlmSettings;value?:AgentModelSelection|null;onChange:(value:AgentModelSelection|null)=>void;required?:boolean;emptyLabel?:string;initialEngine?:LoopEngine;modelLabel?:string}){
  const [chosen,setChosen]=useState<LoopEngine|''>(value?.engine??initialEngine??'');
  const engine=value?.engine??chosen;
  const descriptor=engine?engineDescriptor(engine):undefined;
  const profiles=models?.profiles.filter(p=>engine&&p.models.some(m=>providerSupportsEngine(engine,p,m.id)))??[];
  const selectable=(p:NonNullable<LlmSettings>['profiles'][number])=>p.models.filter(m=>m.enabled&&engine&&providerSupportsEngine(engine,p,m.id));
  const pair=value?JSON.stringify([value.profileId,value.modelId]):'';
  const available=!value||profiles.some(p=>p.id===value.profileId&&selectable(p).some(m=>m.id===value.modelId));
  const emptyReason=!models?.profiles.length?'尚未配置供应商，请到模型设置中添加供应商与模型。'
    :!profiles.length?`当前供应商没有适用的兼容接口。${engine==='claude-code'?'Claude Code 需要 Anthropic Messages 兼容端点；仅有 OpenAI Chat/Responses 地址时不能直接切换协议。':engine==='codex'?'Codex 需要 OpenAI Responses 端点。':'请检查供应商接口协议。'}请在模型设置中选择供应商预设或添加兼容接口，同一供应商共用一份 Key。`
    :'兼容供应商没有已启用模型，请在模型设置中添加或启用模型；获取目录失败时也可手动添加真实模型 ID。';
  return <><label>Loop 引擎<select aria-label="Agent Loop 引擎" required={required} value={engine} onChange={event=>{setChosen(event.target.value as LoopEngine|'');onChange(null)}}><option value="">{emptyLabel}</option>{loopEngineSchema.options.map(item=><option key={item} value={item}>{engineLabel(item)}</option>)}</select></label>
    {models&&engine&&!profiles.some(p=>selectable(p).length)&&<p role="status">当前没有与 {engineLabel(engine)} 兼容的已启用模型。{emptyReason}</p>}
    {descriptor&&<p className="inline-note">擅长：{descriptor.businessTypes.join('、')} · 支持 {descriptor.supportedApis.join(' / ')} 兼容模型</p>}
    <label>生成模型<select aria-label={modelLabel} required={required||!!engine} disabled={!engine||!models} value={pair} onChange={event=>{if(!event.target.value){onChange(null);return}const [profileId,modelId]=JSON.parse(event.target.value);onChange({engine:engine as LoopEngine,profileId,modelId,...(value?.engine!==engine||value.modelRoles===undefined?{}:{modelRoles:value.modelRoles})})}}><option value="">{engine?'请选择模型':emptyLabel}</option>{!available&&<option value={pair} disabled>原模型已不可用</option>}{profiles.flatMap(p=>selectable(p).map(m=><option key={JSON.stringify([p.id,m.id])} value={JSON.stringify([p.id,m.id])}>{p.name} / {m.name||m.id}</option>))}</select></label>{!available&&<p role="alert">原引擎或模型已删除、禁用，请重新选择。</p>}
    {models&&(descriptor?.additionalModelRoles??[]).map(role=>{const choices=modelRoleChoices(role,models),selected=value?.modelRoles?.roles[role.id],pair=selected?JSON.stringify([selected.profileId,selected.modelId]):'',valid=!selected||choices.some(choice=>choice.profileId===selected.profileId&&choice.modelId===selected.modelId);return <label key={role.id}>{role.label}{role.required?'（必填）':''}<select aria-label={'Agent '+role.label} required={role.required} disabled={!value} value={pair} onChange={event=>{if(!value)return;const roles={...value.modelRoles?.roles};if(event.target.value){const [profileId,modelId]=JSON.parse(event.target.value);roles[role.id]={kind:role.kind,profileId,modelId}}else delete roles[role.id];onChange({...value,modelRoles:{version:2,roles}})}}><option value="">{choices.length?'请选择'+role.label:'尚无可用的'+(role.kind==='embedding'?'向量模型':'生成模型')}</option>{!valid&&<option value={pair} disabled>原角色模型已不可用</option>}{choices.map(choice=><option key={JSON.stringify([choice.profileId,choice.modelId])} value={JSON.stringify([choice.profileId,choice.modelId])}>{choice.label}</option>)}</select>{!choices.length&&<small>请在模型设置中添加并启用对应能力的模型。</small>}</label>})}
  </>;
}
