/**
 * 作用定位：Agent 编辑和岗位登记共用的引擎/模型级联下拉菜单。
 * 设计原因：按协议而非模型名称筛选；区分未配置、协议不兼容和模型禁用，列表不以联网或鉴权结果隐藏已保存模型。
 */
import {useState} from 'react';
import {engineSupportsApi,engineLabel,loopEngineSchema,type AgentModelSelection,type LlmSettings,type LoopEngine} from '../../bridge/contracts/models';

export function EngineModelPicker({models,value,onChange,required=false,emptyLabel='使用本机默认配置',initialEngine,modelLabel='Agent 模型'}:{models?:LlmSettings;value?:AgentModelSelection|null;onChange:(value:AgentModelSelection|null)=>void;required?:boolean;emptyLabel?:string;initialEngine?:LoopEngine;modelLabel?:string}){
  const [chosen,setChosen]=useState<LoopEngine|''>(value?.engine??initialEngine??'');
  const engine=value?.engine??chosen;
  const profiles=models?.profiles.filter(p=>engine&&engineSupportsApi(engine,p.api))??[];
  const pair=value?JSON.stringify([value.profileId,value.modelId]):'';
  const available=!value||profiles.some(p=>p.id===value.profileId&&p.models.some(m=>m.enabled&&m.id===value.modelId));
  const emptyReason=!models?.profiles.length?'尚未配置供应商，请到模型设置中添加供应商与模型。'
    :!profiles.length?`当前供应商的接口协议不兼容。${engine==='claude-code'?'Claude Code 需要 Anthropic Messages 兼容端点，可使用非 Claude 模型 ID；仅有 OpenAI Chat/Responses 地址时不能直接切换协议。':engine==='codex'?'Codex 需要 OpenAI Responses 端点。':'请检查供应商接口协议。'}`
    :'兼容供应商没有已启用模型，请在模型设置中添加或启用模型；获取目录失败时也可手动添加真实模型 ID。';
  return <><label>Loop 引擎<select aria-label="Agent Loop 引擎" required={required} value={engine} onChange={event=>{setChosen(event.target.value as LoopEngine|'');onChange(null)}}><option value="">{emptyLabel}</option>{loopEngineSchema.options.map(item=><option key={item} value={item}>{engineLabel(item)}</option>)}</select></label>
    {models&&engine&&!profiles.some(p=>p.models.some(m=>m.enabled))&&<p role="status">当前没有与 {engineLabel(engine)} 兼容的已启用模型。{emptyReason}</p>}
    <label>模型<select aria-label={modelLabel} required={required||!!engine} disabled={!engine||!models} value={pair} onChange={event=>{if(!event.target.value){onChange(null);return}const [profileId,modelId]=JSON.parse(event.target.value);onChange({engine:engine as LoopEngine,profileId,modelId})}}><option value="">{engine?'请选择模型':emptyLabel}</option>{!available&&<option value={pair} disabled>原模型已不可用</option>}{profiles.flatMap(p=>p.models.filter(m=>m.enabled).map(m=><option key={JSON.stringify([p.id,m.id])} value={JSON.stringify([p.id,m.id])}>{p.name} / {m.name||m.id}</option>))}</select></label>{!available&&<p role="alert">原引擎或模型已删除、禁用，请重新选择。</p>}</>;
}
