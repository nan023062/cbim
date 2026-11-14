/**
 * 作用定位：主对话中完整引擎与模型角色配置草稿，复用 Agent 页面选择器。
 * 设计原因：多模型必填项完整后一次提交同一主 Agent 设置；编辑阶段不拆成多个保存，不改对话草稿或运行快照。
 */
import {useState} from 'react';
import type {AgentModelSelection} from '../../bridge/contracts/agent-settings';
import type {LlmSettings} from '../../bridge/contracts/models';
import {engineSelectionAvailable,type LoopEngine} from '../../bridge/contracts/engines';
import {EngineModelPicker} from './EngineModelPicker';
export function AgentModelForm({models,initial,engine,busy,onSave,onCancel}:{models:LlmSettings;initial?:AgentModelSelection;engine?:LoopEngine;busy:boolean;onSave:(value:AgentModelSelection)=>Promise<void>;onCancel:()=>void}){
  const [draft,setDraft]=useState<AgentModelSelection|null>(initial??null);
  return <form className="model-form" aria-label="主 Agent 引擎与模型" onSubmit={event=>{event.preventDefault();if(draft&&engineSelectionAvailable(draft,models))void onSave(draft)}}><fieldset disabled={busy}><legend>主 Agent 引擎与模型</legend><EngineModelPicker models={models} value={draft} onChange={setDraft} initialEngine={engine} required/><p>与 Agent 页面共用设置，保存后用于下一次运行。</p><button type="submit" disabled={!engineSelectionAvailable(draft,models)}>保存主 Agent 配置</button><button type="button" onClick={onCancel}>取消配置</button></fieldset></form>;
}
