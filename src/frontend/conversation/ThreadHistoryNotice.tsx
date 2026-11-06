/**
 * 作用定位：显示主会话中无法读取的历史轮次，并只按后端确认的运行头提供续接记录。
 * 设计原因：坏历史不应遮住新核实周期，也不能被伪造成正常 RunSummary 或让续聊退回更早的原生上下文。这里没有修复、重放或运行操作。
 */
import type {RunSummary,ConversationThreadView} from '../../bridge/contracts/execution';

/** 缺少可信运行头即不可续接，绝不回退 runs.at(-1)。 */
export function threadResumeRun(runs:readonly RunSummary[],resumeRunId?:string){return resumeRunId?runs.find(run=>run.runId===resumeRunId):undefined}

export function ThreadHistoryNotice({issues}:{issues:ConversationThreadView['issues']}){
  if(!issues.length)return null;
  return <section className="thread-history-issues" data-testid="thread-history-issues" aria-label="历史执行记录问题">
    <p>部分历史记录无法完整读取，原记录仍保留。以下轮次仅显示问题，不作为正常执行结果或续接依据。</p>
    {issues.map(issue=><details key={issue.runId} data-testid="thread-history-issue"><summary>历史轮次 {issue.runId.slice(0,8)} · 记录待核实</summary><p>{issue.message}</p><small>{issue.code}</small><p><code>{issue.runId}</code></p></details>)}
  </section>;
}
