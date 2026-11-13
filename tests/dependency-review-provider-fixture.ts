import assert from 'node:assert/strict';
import {goalInspection,type GoalFixtureRequest} from './goal-provider-fixture';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {ServerResponse} from 'node:http';

/** Native Pi compaction has no business tools; keep its requests separately, never advance member scripts. */
export function serveFixtureCompaction(body:GoalFixtureRequest&{model:string;tools?:unknown[]},res:ServerResponse,requests:GoalFixtureRequest[]):boolean{
  if(body.tools?.length||typeof body.messages[0]?.content!=='string'||!body.messages[0].content.includes('context summarization assistant'))return false;
  requests.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});
  const summary='## Goal\n继续原用户目标并保留所有补充。\n## Progress\n已经执行的任务不重放。\n## Key Decisions\n只以 cbim_goal_inspect 当前图及真实工具响应判断任务、检查点、审阅和版本；摘要不是执行证据。\n## Next Steps\n核对当前候选，显式审阅前置后结束主轮；最终按最新目标审阅。';
  for(const [delta,finish_reason]of [[{role:'assistant',content:summary},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'fixture-compaction-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
  res.end('data: [DONE]\n\n');return true;
}

/** Scripted model rounds explicitly accept real candidates before dependent execution.
 * All HTTP requests remain in the provider log; offset counts the added inspect/review/end rounds.
 * This helper emits tools only: it never edits graph state or bypasses production review validation.
 */
export class DependencyReviewRounds {
  offset=0;
  readonly receipts:TaskNode[]=[];
  private pending?:{id:string;task:TaskNode};
  handle(body:GoalFixtureRequest,inspectionId:string,tool:(id:string,name:string,args:unknown)=>void,reply:(text:string)=>void):boolean {
    const last=body.messages.at(-1);
    if(this.pending&&last?.role==='tool'&&last.tool_call_id===this.pending.id){
      assert.equal(typeof last.content,'string');const saved=JSON.parse(last.content as string) as TaskNode;
      assert.equal(saved.taskId,this.pending.task.taskId);assert.equal(saved.candidateReview?.decision,'accept');
      assert.equal(saved.candidateReview.resultId,this.pending.task.result!.resultId);
      assert.equal(saved.candidateReview.runId,this.pending.task.result!.runId);
      assert.equal(saved.revision,this.pending.task.revision+1);this.receipts.push(saved);this.pending=undefined;
      this.offset++;reply('已通过真实审阅入口接受这一份前置候选；结束本主轮，由调度器核实并启动原后继。');return true;
    }
    if(last?.role!=='tool'||last.tool_call_id!==inspectionId)return false;
    const {graph}=goalInspection(body,inspectionId);
    const task=graph.tasks.find(source=>source.status==='result_ready'&&source.result&&!source.candidateReview&&graph.edges.some(edge=>edge.kind==='dependency'&&edge.enabled&&edge.condition.reviewRequired&&edge.fromNodeId===source.nodeId&&graph.tasks.some(target=>target.nodeId===edge.toNodeId&&!target.runIds.length&&['queued','waiting'].includes(target.status))));
    if(!task)return false;
    assert.ok(task.result!.evidenceRefs.length);assert.equal(task.result!.planRevision,task.planRevision);
    const id='dependency-candidate-review-'+this.receipts.length;this.pending={id,task};this.offset+=2;
    tool(id,'cbim_dispatch_review',{taskId:task.taskId,expectedRevision:task.revision,resultId:task.result!.resultId,decision:'accept',reason:'已核实真实读取候选、当前计划及工具证据引用，允许原依赖继续；整体目标仍待最终审阅。'});return true;
  }
}
