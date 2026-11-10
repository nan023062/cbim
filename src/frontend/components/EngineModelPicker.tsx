/**
 * 作用定位：Agent 编辑和岗位登记共用的引擎/模型级联下拉菜单。
 * 设计原因：三个内置引擎均可选择；统一模型目录按协议兼容性筛选，改引擎清除旧模型引用，失效选型保留提示而不暗中替换。
 */
import {useState} from 'react';
import {engineSupportsApi,engineLabel,loopEngineSchema,type AgentModelSelection,type LlmSettings,type LoopEngine} from '../../bridge/contracts/models';

export function EngineModelPicker({models,value,onChange,required=false,emptyLabel='使用本机默认配置',initialEngine,modelLabel='Agent 模型'}:{models?:LlmSettings;value?:AgentModelSelection|null;onChange:(value:AgentModelSelection|null)=>void;required?:boolean;emptyLabel?:string;initialEngine?:LoopEngine;modelLabel?:string}){
  const [chosen,setChosen]=useState<LoopEngine|''>(value?.engine??initialEngine??'');
  const engine=value?.engine??chosen;
  const profiles=models?.profiles.filter(p=>engine&&engineSupportsApi(engine,p.api))??[];
  const pair=value?JSON.stringify([value.profileId,value.modelId]):'';
  const available=!value||profiles.some(p=>p.id===value.profileId&&p.models.some(m=>m.enabled&&m.id===value.modelId));
  return <><label>Loop 引擎<select aria-label="Agent Loop 引擎" required={required} value={engine} onChange={event=>{setChosen(event.target.value as LoopEngine|'');onChange(null)}}><option value="">{emptyLabel}</option>{loopEngineSchema.options.map(item=><option key={item} value={item}>{engineLabel(item)}</option>)}</select></label>
    {models&&engine&&!profiles.some(p=>p.models.some(m=>m.enabled))&&<p>当前没有与 {engineLabel(engine)} 兼容的已启用模型，请在模型设置中检查接口协议与模型列表。</p>}
    <label>模型<select aria-label={modelLabel} required={required||!!engine} disabled={!engine||!models} value={pair} onChange={event=>{if(!event.target.value){onChange(null);return}const [profileId,modelId]=JSON.parse(event.target.value);onChange({engine:engine as LoopEngine,profileId,modelId})}}><option value="">{engine?'请选择模型':emptyLabel}</option>{!available&&<option value={pair} disabled>原模型已不可用</option>}{profiles.flatMap(p=>p.models.filter(m=>m.enabled).map(m=><option key={JSON.stringify([p.id,m.id])} value={JSON.stringify([p.id,m.id])}>{p.name} / {m.name||m.id}</option>))}</select></label>{!available&&<p role="alert">原引擎或模型已删除、禁用，请重新选择。</p>}</>;
}
