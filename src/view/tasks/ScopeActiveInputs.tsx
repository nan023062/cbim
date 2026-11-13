/**
 * 作用定位：在主对话和任务根的目标详情中展示运行内补充的真实接收历史。
 * 设计原因：原生排队、目标输入升版与完成验收是不同事实；仅展示持久回执，未知或重开不能触发再次发送。
 * 职责边界：正文是实际发送的队列快照，可能包含展开的附件资料，不还原成用户原始措辞；没有回执时不借用当前输入框内容。
 */
import {scopeActiveInputSchema} from '../../bridge/contracts/dispatch';
import type {ScopeActiveInput} from '../../bridge/contracts/dispatch';

const labels={pending:'接收确认中',accepted:'已接收输入快照',rejected:'未发送',unknown:'接收结果待核实'};

/** 只消费当前已核对周期的记录；不查询附件、不读原生会话，也不提供重试或恢复按钮。 */
export function ScopeActiveInputs({items}:{items:readonly ScopeActiveInput[]}){
  if(!Array.isArray(items as unknown))return <p className="scope-goal-alert" role="alert" data-testid="scope-active-input-invalid">运行内补充记录无效，请重新同步目标详情。</p>;
  if(!items.length)return null;
  if(items.length>64||items.some(item=>!scopeActiveInputSchema.safeParse(item).success)||new Set(items.map(item=>item.insertionId)).size!==items.length)return <p className="scope-goal-alert" role="alert" data-testid="scope-active-input-invalid">运行内补充记录无效，不能据此判断接收状态；请重新同步目标详情。</p>;
  return <div className="scope-goal-section" data-testid="scope-active-inputs">
    <h4>运行内补充记录</h4>
    <p className="scope-goal-muted">接收表示已加入原运行的输入队列，不代表模型已处理或目标已完成。输入快照可能包含展开的附件资料；本轮原始输入保持不变。</p>
    {items.map(item=><details className="scope-active-input" key={item.insertionId} data-testid="scope-active-input" data-input-status={item.status}>
      <summary><span>{labels[item.status]}</span>{item.status==='accepted'&&<span> · 输入第 {item.inputRevision} 版</span>}<small> · {new Date(item.preparedAt).toLocaleString()}</small></summary>
      {item.status==='accepted'?<>
        <div className="scope-goal-input" data-testid="scope-active-input-message">{item.input.message}</div>
        <p className="scope-goal-muted">已登记为目标第 {item.goalRevision} 版 · {new Date(item.acceptedAt).toLocaleString()}{!!item.attachmentIds?.length&&` · ${item.attachmentIds.length} 份附件快照`}</p>
      </>:item.status==='pending'?<p className="scope-goal-muted">尚未确认原生接收；原目标不能沿旧审阅完成。重开不会自动重发。</p>:<p className={item.status==='unknown'?'scope-goal-blocked':'scope-goal-muted'}>{item.reason}{item.status==='unknown'&&'；无法推断未发送，不会自动重试。'}</p>}
      <p className="scope-goal-metadata">原运行 <code>{item.runId}</code><br/>队列项 <code>{item.queueId}</code></p>
    </details>)}
  </div>;
}
