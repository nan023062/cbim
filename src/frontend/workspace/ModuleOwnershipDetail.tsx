/**
 * 作用定位：显示模块当前负责人、来源观察与有界审计，供责任面板单独审阅。
 * 设计原因：来源代次与定义内容观察分开呈现；未配置时显示主 Agent 默认责任；自定义负责人关系供新业务派发核实，更换不迁移旧任务，当前同哈希也不能替代明确采纳。
 */
import type {ModuleOwnershipDetail} from '../../bridge/contracts/module-ownership';
import {KnowledgeSourceDetails} from '../knowledge/KnowledgeSourceDetails';

/** 只呈现后端核实后的快照，文字按 React 文本处理，不执行知识内容。 */
export function ModuleOwnershipDetailView({detail}:{detail:ModuleOwnershipDetail}){
  const view=detail.view,binding=view.binding;
  return <section className="module-ownership-detail" data-testid="module-ownership-detail">
    <h3>{view.module?.name??view.moduleId}</h3><code>{view.moduleId}</code>
    <p>{ownershipStatus(view.status)}{view.owner&&<> · <strong>{view.owner.name}</strong> · 岗位第 {view.owner.revision} 版</>}</p>
    {binding&&<p>责任第 {binding.revision} 版 · <code>{binding.bindingId}</code></p>}
    <p data-testid="module-ownership-source">{sourceStatus(view.source.status)}{'issue' in view.source&&<>：{view.source.issue}</>}</p>
    <KnowledgeSourceDetails state={view.sourceStatus} adopted={binding?.sourceRef}/>
    <p className="module-ownership-note">新业务按模块负责人派发，领取时重新核实岗位、来源和模型。负责人变更不移交已有任务；历史保留原身份，旧待办不能自动换人续执行。</p>
    <details data-testid="module-ownership-history"><summary>责任历史 · {detail.history.total} 条{detail.history.truncated?'（只展示最近 20 条）':''}</summary>{detail.history.items.map(item=><article className="module-ownership-history-item" key={item.changeId}><strong>第 {item.revision} 版 · {item.actor.kind==='main_agent'?'主 Agent 治理':'本机明确提交'}</strong><small>{new Date(item.committedAt).toLocaleString()}</small><p>{item.reason}</p><p>原负责人：<code>{item.previousOwnerMemberId??'未设置'}</code><br/>新负责人：<code>{item.ownerMemberId??'解除负责人'}</code></p><details><summary>查看原命令来源</summary><pre>{JSON.stringify({commandId:item.commandId,changeId:item.changeId,actor:item.actor},null,2)}</pre></details></article>)}</details>
  </section>;
}
export function ownershipStatus(status:string){return ({unassigned:'主 Agent 默认执行',assigned:'已登记负责人',owner_suspended:'负责人岗位已暂停',owner_retired:'负责人岗位已退休',owner_missing:'负责人岗位缺失'} as Record<string,string>)[status]??status}
function sourceStatus(status:string){return ({observed:'已读取当前模块，尚无登记观察',same:'当前定义与登记观察一致',changed:'当前定义与登记观察不同',missing:'当前模块已缺失',invalid:'当前模块定义不可用',unavailable:'当前来源尚无法核实'} as Record<string,string>)[status]??status}
