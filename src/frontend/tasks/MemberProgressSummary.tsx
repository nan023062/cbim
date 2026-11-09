/**
 * 作用定位：在成员公开对话卡中直接展示结构化步骤、证据数量及交付限制。
 * 设计原因：工具折叠时仍能看见实际计划推进；reported_done 只标“已报告”，候选保持尚未验收，不生成新的执行事实。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
/** 只消费已筛选的公开计划；折叠不改变订阅、权限或成员执行。 */
export function MemberProgressSummary({run,compact=false}:{run:RunSummary;compact?:boolean}){
  const plan=run.taskProgress;if(!plan)return null;
  const active=plan.steps.filter(step=>step.state==='working'),shown=compact?(active.length?active:plan.steps.slice(-3)):plan.steps;
  const labels={pending:'待执行',working:'正在执行',reported_done:'已报告'};
  const steps=(items:typeof plan.steps)=><ul>{items.map(step=><li key={step.id}><strong>{labels[step.state]} · {step.title}</strong>{step.evidence.length>0&&<span> · {step.evidence.length} 项证据引用</span>}</li>)}</ul>;
  return <section className="member-progress-summary" aria-label="成员计划进度"><strong>执行计划 · 第 {plan.version} 版</strong>{steps(shown)}
    {compact&&shown.length<plan.steps.length&&<details><summary>查看全部 {plan.steps.length} 个步骤</summary>{steps(plan.steps)}</details>}
    {plan.delivery&&<div className="member-delivery-summary"><strong>交付候选 · 尚未验收</strong><p>{plan.delivery.summary}</p>{plan.delivery.limitations.length>0&&<details open={!compact}><summary>限制与待验证项 · {plan.delivery.limitations.length}</summary><ul>{plan.delivery.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></details>}</div>}
  </section>;
}
