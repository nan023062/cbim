/**
 * 作用定位：显示主会话中无法读取的历史轮次，并只按后端确认的运行头提供续接记录。
 * 设计原因：坏历史不应遮住新核实周期，也不能被伪造成正常 RunSummary 或让续聊退回更早的原生上下文。
 * 恢复入口只导航原运行或创建空对话，原历史、草稿及附件保留，不修改日志或自动重放工具。
 */
import type {RunSummary,ConversationThreadView} from '../../bridge/contracts/execution';

/** 缺少可信运行头即不可续接，绝不回退 runs.at(-1)。 */
export function threadResumeRun(runs:readonly RunSummary[],resumeRunId?:string){return resumeRunId?runs.find(run=>run.runId===resumeRunId):undefined}

/** 解释空闲会话的续接阻断；发送资格和提示共用判断，不能因旧轮次可读而回退。 */
export function threadRecoveryReason(run?:RunSummary):string|undefined{
  if(!run)return '当前会话没有可安全续接的执行记录。';
  if(run.logIntegrity?.partialTail)return '原运行日志不完整，需要先核实执行结果。';
  if(run.unresolvedTools.length)return '原工具操作的结果尚未确认，需要先核实当前影响。';
  if(!run.sessionFile)return '原运行未登记可恢复的原生会话文件，无法直接续接。';
  return undefined;
}

/** 导航不触发模型或修改原执行；新对话由外壳创建，原页签仍持有草稿和附件。 */
export function ThreadRecoveryNotice({reason,disabled,onInspect,onNewConversation}:{reason:string;disabled:boolean;onInspect:()=>void;onNewConversation:()=>void}){
  return <section className="chat-reconcile" data-testid="thread-recovery-notice" aria-label="对话恢复" role="status">
    <p>{reason}原记录、草稿和附件仍保留。</p>
    <p>可查看原运行并使用核实入口；也可新建对话，重新说明要继续的工作。新对话不会自动继承上下文或重发原操作。</p>
    <button disabled={disabled} onClick={onInspect}>查看原运行</button>{' '}
    <button disabled={disabled} onClick={onNewConversation}>新建对话继续</button>
  </section>;
}

export function ThreadHistoryNotice({issues}:{issues:ConversationThreadView['issues']}){
  if(!issues.length)return null;
  return <section className="thread-history-issues" data-testid="thread-history-issues" aria-label="历史执行记录问题">
    <p>部分历史记录无法完整读取，原记录仍保留。以下轮次仅显示问题，不作为正常执行结果或续接依据。</p>
    {issues.map(issue=><details key={issue.runId} data-testid="thread-history-issue"><summary>历史轮次 {issue.runId.slice(0,8)} · 记录待核实</summary><p>{issue.message}</p><small>{issue.code}</small><p><code>{issue.runId}</code></p></details>)}
  </section>;
}
