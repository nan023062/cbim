/**
 * 作用定位：用原主运行的成功派发回执，将内联工具条目关联到同会话的真实任务节点。
 * 设计原因：工具返回文本、目标名称与当前选中周期均不足以证明归属；严格核对回执身份和图游标，不为旧日志猜测任务，也不创建新的调度事件。
 * 边界：只消费后端已核实的日志和公开图；哈希与原命令 canonical 核实仍归后端，图上的最新状态不是原调用的返回结果。
 */
import {dispatchTaskOutputSchema,toolReceiptSchema,type GraphSnapshot,type TaskNode} from '../../bridge/contracts/dispatch';
import type {RunSummary} from '../../bridge/contracts/execution';
import {mainCommandSelection} from '../tasks/command-verification-state';

function sameMainGraph(run:RunSummary,graph:GraphSnapshot|undefined):graph is GraphSnapshot{
  const task=run.task,binding=run.conversationBinding;
  return !!graph&&!!task&&task.mode==='chat'&&task.agentId==='cbim:main'&&!run.memberBinding&&!!binding&&binding.agentId==='cbim:main'&&binding.workspaceId===task.workspaceId&&binding.rootSessionId===task.taskId&&graph.identity.workspaceId===task.workspaceId&&graph.identity.rootSessionId===task.taskId&&graph.cursor.workspaceId===task.workspaceId&&graph.cursor.rootSessionId===task.taskId&&graph.root.identity.workspaceId===task.workspaceId&&graph.root.identity.rootSessionId===task.taskId&&graph.root.agent.agentInstanceId===binding.agentInstanceId;
}
/** 没有完整成功证据、图尚未追齐或来自另一条流时，只保留原工具记录。 */
export function inlineDispatchedTask(run:RunSummary,toolCallId:string,graph:GraphSnapshot|undefined):TaskNode|undefined{
  if(!sameMainGraph(run,graph))return;
  const name='cbim_dispatch_task',selection=mainCommandSelection(run,toolCallId,name);
  if(!selection)return;
  const event=run.events.filter(e=>e.type==='tool.finished'&&e.data.id===toolCallId).at(-1);
  if(!event||event.data.name!==name||event.data.isError===true||event.workspaceId!==selection.workspaceId||event.taskId!==selection.rootSessionId||event.runId!==run.runId)return;
  const receipt=toolReceiptSchema.safeParse(event.data.receipt);
  if(!receipt.success)return;
  const r=receipt.data;
  if(r.outcome!=='succeeded'||r.toolName!==name||r.toolCallId!==toolCallId||r.workspaceId!==selection.workspaceId||r.scope.workspaceId!==selection.workspaceId||r.taskId!==selection.rootSessionId||r.runId!==run.runId)return;
  const result=event.data.result as {content?:{type?:string;text?:string}[]}|undefined;
  if(!Array.isArray(result?.content)||result.content.length!==1||result.content[0].type!=='text'||typeof result.content[0].text!=='string')return;
  try{
    const parsed=dispatchTaskOutputSchema.safeParse(JSON.parse(result.content[0].text));if(!parsed.success)return;
    const {cursor,taskId}=parsed.data;
    if(cursor.workspaceId!==selection.workspaceId||cursor.rootSessionId!==selection.rootSessionId||cursor.streamId!==graph.cursor.streamId||cursor.seq>graph.cursor.seq)return;
    const tasks=graph.tasks.filter(task=>task.taskId===taskId);
    if(tasks.length===1&&tasks[0].identity.workspaceId===selection.workspaceId&&tasks[0].identity.rootSessionId===selection.rootSessionId)return tasks[0];
  }catch{/* 旧或不完整输出仍在原工具轨道中可读，不借名称补造关联。 */}
}
/** 依赖消费只取边上已保存的 resultId；源任务产生候选不代表接收者已经读取。 */
export function inlineDependencies(task:TaskNode,graph:GraphSnapshot):{id:string;text:string;received:boolean}[]{
  return graph.edges.filter(e=>e.kind==='dependency'&&e.enabled&&e.toNodeId===task.nodeId&&e.identity.workspaceId===task.identity.workspaceId&&e.identity.rootSessionId===task.identity.rootSessionId).map(edge=>{
    const source=graph.tasks.find(t=>t.nodeId===edge.fromNodeId),received=edge.kind==='dependency'&&!!edge.condition.resultId;
    return {id:edge.edgeId,received,text:`${received?'已接收前置候选':'等待前置成果'} · ${source?source.assignee.name+'：'+source.goal:'原前置任务'}`};
  });
}
/** 系统回注保留真实来源，只给本会话的已知任务装配只读导航；不把回注伪装成新工具执行。 */
export function inlineHandoffTasks(run:RunSummary,graph:GraphSnapshot|undefined):TaskNode[]{
  const source=run.source??run.events[0]?.data.source as RunSummary['source'];
  if(!sameMainGraph(run,graph)||source?.kind!=='member-results'||!Array.isArray(source.taskIds))return [];
  return graph.tasks.filter(t=>source.taskIds.includes(t.taskId)&&t.identity.workspaceId===graph.identity.workspaceId&&t.identity.rootSessionId===graph.identity.rootSessionId);
}
