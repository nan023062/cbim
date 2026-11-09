/**
 * 自动分配显示真实兜底原因与原对话模型，不标作旧岗位缺失，不生成登记或批准入口。
 * 作用定位：在目标责任分配和成员任务中呈现冻结的岗位、模型、来源与责任版本。
 * 设计原因：历史显示不依赖当前岗位查询；先核本地身份对应再显示，不把同名角色、配置一致或旧候选解释为可直接执行。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {automaticExecutionBindingMatches,type AutomaticExecutionBinding,ownerExecutionBindingMatches,type OwnerExecutionBinding} from '../../bridge/contracts/owner-execution';
import {ownerTaskView} from './owner-execution-state';
import './owner-execution.css';

/** 组件只读原绑定；compact 用于主对话摘要，不查询当前配置或密钥。 */
export function OwnerExecutionDetails({binding,workspaceId,agentId,moduleIds,compact=false}:{binding:OwnerExecutionBinding;workspaceId:string;agentId:string;moduleIds:string[];compact?:boolean}){
  if(!ownerExecutionBindingMatches(binding,workspaceId,agentId,moduleIds))return <p className="owner-execution-warning" role="alert" data-testid="owner-binding-invalid">岗位绑定与原任务身份不一致，请重新同步核实。</p>;
  const summary=<span>岗位第 {binding.memberRevision} 版 · {binding.model.modelId}</span>;
  return <section className={'owner-execution'+(compact?' compact':'')} aria-label="原任务岗位与模型" data-testid="owner-execution-binding" data-member-id={binding.memberId} data-model-id={binding.model.modelId}>
    {compact?<p>{summary}</p>:<>
      <p className="owner-execution-summary">{summary}</p>
      <details><summary>查看原负责人和执行依据</summary>
        <dl><div><dt>项目岗位</dt><dd><code>{binding.memberId}</code></dd></div><div><dt>静态 Agent</dt><dd><code>{binding.capability.agentId}</code></dd></div><div><dt>模型供应商配置</dt><dd><code>{binding.model.profileId}</code></dd></div><div><dt>模型指纹</dt><dd><code>{binding.model.configurationHash}</code></dd></div><div><dt>能力采纳</dt><dd><code>{binding.capability.captureId}</code></dd></div><div><dt>能力来源</dt><dd><code>{'generationId' in binding.capability.sourceRef?binding.capability.sourceRef.generationId:'系统内置执行能力'}</code></dd></div></dl>
        <ul>{binding.owners.map(owner=><li key={owner.moduleId} data-module-id={owner.moduleId}><strong>{owner.moduleId}</strong><span>责任第 {owner.revision} 版</span><code>{owner.bindingId}</code><small>模块来源：{owner.sourceRef.generationId}</small></li>)}</ul>
        <p className="owner-execution-muted">以上是原派发记录。后续改名、换人或配置修改不会覆盖历史；新领取仍须由调度系统重新核实。</p>
      </details>
    </>}
  </section>;
}

/** 缺省与损坏分开；旧在途和历史结果不因没有新协议字段而被改显示为执行失败。 */
export function MemberOwnerNotice({task,compact=false}:{task:TaskNode;compact?:boolean}){
  if(task.fallbackBinding)return <AutomaticExecutionDetails binding={task.fallbackBinding} workspaceId={task.identity.workspaceId} scopeId={task.scopeId} agentId={task.assignee.agentId} moduleIds={task.modules.map(m=>m.moduleId)}/>;
  const view=ownerTaskView(task);
  if(view.kind==='invalid')return <p className="owner-execution-warning" role="alert" data-testid="owner-binding-invalid">岗位绑定与原任务身份不一致，请重新同步核实。</p>;
  if(view.kind==='bound')return <OwnerExecutionDetails binding={view.binding} workspaceId={task.identity.workspaceId} agentId={task.assignee.agentId} moduleIds={task.modules.map(module=>module.moduleId)} compact={compact}/>;
  return <p className={view.needsReplan?'owner-execution-warning':'owner-execution-muted'} data-testid="owner-binding-legacy" data-needs-replan={view.needsReplan}>{view.needsReplan?'旧任务尚无可信岗位绑定，不能新领取或续执行；请由主 Agent 按当前负责人重新规划。':'旧执行记录未保存项目岗位绑定；保留当时的角色与结果，不自动补配当前负责人。'}</p>;
}

/** 直接展示原兜底事实及原因；不把自动身份显示为旧岗位缺失或人工责任确认。 */
export function AutomaticExecutionDetails({binding,workspaceId,scopeId,agentId,moduleIds}:{binding:AutomaticExecutionBinding;workspaceId:string;scopeId?:string;agentId:string;moduleIds:string[]}){
  if(!automaticExecutionBindingMatches(binding,workspaceId,scopeId,agentId,moduleIds))return <p role="alert" className="owner-execution-warning">自动执行记录与当前任务身份不一致，请重新同步核实。</p>;
  return <section className="owner-execution" aria-label="自动执行依据" data-testid="automatic-execution-binding"><p>自动模式 · 内置执行员兜底</p><p>{binding.reason==='no_modules'?'项目尚无业务模块，临时以全项目为范围。':'所选模块尚未分配负责人。'}</p><p>原对话模型：{binding.model.modelId}</p><p className="owner-execution-muted">未登记长期负责岗位；执行仍遵守原权限与人工验收要求。</p></section>;
}
