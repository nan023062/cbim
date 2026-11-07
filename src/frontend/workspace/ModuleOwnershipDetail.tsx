/**
 * 作用定位：显示模块当前负责人、来源观察与有界审计，供责任面板单独审阅。
 * 设计原因：登记事实与真实执行分开呈现；当前同哈希不代表来源连续，旧任务也不能按当前负责人重新解释。
 */
import type {ModuleOwnershipDetail} from '../../bridge/contracts/module-ownership';

/** 只呈现后端核实后的快照，文字按 React 文本处理，不执行知识内容。 */
export function ModuleOwnershipDetailView({detail}:{detail:ModuleOwnershipDetail}){
  const view=detail.view,binding=view.binding;
  return <section className="module-ownership-detail" data-testid="module-ownership-detail">
    <h3>{view.module?.name??view.moduleId}</h3><code>{view.moduleId}</code>
    <p>{ownershipStatus(view.status)}{view.owner&&<> · <strong>{view.owner.name}</strong> · 岗位第 {view.owner.revision} 版</>}</p>
    {binding&&<p>责任第 {binding.revision} 版 · <code>{binding.bindingId}</code></p>}
    <p data-testid="module-ownership-source">{sourceStatus(view.source.status)}{'issue' in view.source&&<>：{view.source.issue}</>}</p>
    <p className="module-ownership-note">这里只保存本项目的责任关系，尚未接入按负责人派发。现有任务仍使用原身份；当前来源字节一致也不能证明没有删除重建。</p>
    <details data-testid="module-ownership-history"><summary>责任历史 · {detail.history.total} 条{detail.history.truncated?'（只展示最近 20 条）':''}</summary>{detail.history.items.map(item=><article className="module-ownership-history-item" key={item.changeId}><strong>第 {item.revision} 版 · {item.actor.kind==='main_agent'?'主 Agent 治理':'本机明确提交'}</strong><small>{new Date(item.committedAt).toLocaleString()}</small><p>{item.reason}</p><p>原负责人：<code>{item.previousOwnerMemberId??'未设置'}</code><br/>新负责人：<code>{item.ownerMemberId??'解除负责人'}</code></p><details><summary>查看原命令来源</summary><pre>{JSON.stringify({commandId:item.commandId,changeId:item.changeId,actor:item.actor},null,2)}</pre></details></article>)}</details>
  </section>;
}
export function ownershipStatus(status:string){return ({unassigned:'未设置负责人',assigned:'已登记负责人',owner_suspended:'负责人岗位已暂停',owner_retired:'负责人岗位已退休',owner_missing:'负责人岗位缺失'} as Record<string,string>)[status]??status}
function sourceStatus(status:string){return ({observed:'已读取当前模块，尚无登记观察',same:'当前定义与登记观察一致',changed:'当前定义与登记观察不同',missing:'当前模块已缺失',invalid:'当前模块定义不可用',unavailable:'当前来源尚无法核实'} as Record<string,string>)[status]??status}
