/**
 * 既有任务的自动兜底身份与岗位绑定同样不可补造、更换或删除；换模式只产生后续新目标。
 * 作用定位：把已提交的图事件原子转换为内存投影，并按游标输出增量读取结果。
 * 设计原因：节点、边和成员状态必须一起可见；检查点及预约按不可变前缀逐段追加，依赖审计保留原计划与负责人，终止记录不可复活。
 * 职责边界：不落盘、不分配事件序号、不启动任务；调用方必须先可靠提交再发布结果。
 */
import {fail} from '../foundation/errors';
import {assertGraphIdentity,validateGraph,validateGraphBatch,validateGraphCursor} from './graph-rules';
import type {GraphEventBatch,GraphSnapshot,GraphCursor,GraphDelta,GraphChange,TaskNode} from './graph-types';
import {memberResumeRequests} from './member-checkpoint-chain';

type SeenBatch={fingerprint:string;eventId:string;commandId:string};
// 跟随不可变投影保留已核验的重放证明，不序列化进公开 Snapshot；从日志重建时自然恢复。
const seenBatches=new WeakMap<GraphSnapshot,Map<number,SeenBatch>>();
function stable(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
  return JSON.stringify(value);
}
function changeKey(change:GraphChange){
  switch(change.type){case 'root.upserted':return 'root';case 'task.upserted':return 'task:'+change.task.taskId;case 'edge.upserted':return 'edge:'+change.edge.edgeId;case 'agent.upserted':return 'agent:'+change.agent.agentInstanceId}
}
function nextRevision(previous:{revision:number}|undefined,next:{revision:number}){
  if(next.revision!==(previous?previous.revision+1:1))fail('GRAPH_REVISION_CONFLICT','图对象版本必须从 1 开始并连续递增');
}
function taskRevision(previous:TaskNode,next:TaskNode){
  if(previous.checkpointAbandonment)fail('GRAPH_INPUT_INVALID','为交接放弃的检查点任务已封存，不能改写或恢复');
  if(previous.cancelledBeforeStart)fail('GRAPH_INPUT_INVALID','已撤销的未启动任务已封存，不能再次改写或执行');
  if(previous.scopeId!==next.scopeId||previous.parentTaskId!==next.parentTaskId||stable(previous.requester)!==stable(next.requester)||previous.createdAt!==next.createdAt)fail('GRAPH_INPUT_INVALID','任务调度周期、派发父关系、请求人和创建时间不能改写');
  if(stable(previous.workflowSelections)!==stable(next.workflowSelections))fail('GRAPH_INPUT_INVALID','已有任务的 Workflow 选择不能增删或改写，请重新规划并派发新任务');
  if(stable(previous.fallbackBinding)!==stable(next.fallbackBinding)||stable(previous.ownerBinding)!==stable(next.ownerBinding))fail('GRAPH_INPUT_INVALID','已有任务的负责人绑定不可补造、移除或替换，请明确规划新任务');
  const plan=(t:TaskNode)=>({goal:t.goal,acceptance:t.acceptance,modules:t.modules,assignee:t.assignee});
  const changed=stable(plan(previous))!==stable(plan(next));
  if(next.planRevision!==previous.planRevision+(changed?1:0))fail('GRAPH_REVISION_CONFLICT','任务计划版本与范围修订不一致');
  if(previous.runIds.some((id,index)=>next.runIds[index]!==id))fail('GRAPH_INPUT_INVALID','历史执行轮次不能删除或改写');
  if(previous.help&&stable(previous.help)!==stable(next.help))fail('GRAPH_INPUT_INVALID','已经交接的成员求助不能删除或改写');
  const beforeCheckpoints=previous.checkpoints??[],checkpoints=next.checkpoints??[],beforeRequests=memberResumeRequests(previous),requests=memberResumeRequests(next);
  if(checkpoints.length<beforeCheckpoints.length||checkpoints.length>beforeCheckpoints.length+1||beforeCheckpoints.some((value,index)=>stable(value)!==stable(checkpoints[index])))fail('GRAPH_INPUT_INVALID','检查点只能逐段追加，已交接历史不能删除或改写');
  if(requests.length<beforeRequests.length||requests.length>beforeRequests.length+1||beforeRequests.some((value,index)=>stable(value)!==stable(requests[index])))fail('GRAPH_INPUT_INVALID','续执行预约只能逐段追加，原历史不能删除或改写');
  if((previous.checkpoints||next.checkpoints)&&changed)fail('GRAPH_INPUT_INVALID','检查点及续执行不能修改原任务目标、模块、责任或验收');
  const oldHistory=previous.dependencyReplacements??[],history=next.dependencyReplacements??[];
  if(history.length<oldHistory.length||history.length>oldHistory.length+1||oldHistory.some((record,index)=>stable(record)!==stable(history[index])))fail('GRAPH_INPUT_INVALID','前置替换审计只能逐次追加，不能改删历史');
  if(history.length>oldHistory.length&&changed)fail('GRAPH_INPUT_INVALID','替换前置不能同时修改任务目标、范围、责任或验收');
  const oldAdditions=previous.dependencyAdditions??[],additions=next.dependencyAdditions??[];
  if(additions.length<oldAdditions.length||additions.length>oldAdditions.length+1||oldAdditions.some((record,index)=>stable(record)!==stable(additions[index]))||previous.dependencyAdditions&&!next.dependencyAdditions)fail('GRAPH_INPUT_INVALID','前置追加审计只能逐次追加，不能改删历史');
  if(additions.length>oldAdditions.length&&changed)fail('GRAPH_INPUT_INVALID','追加前置不能同时修改任务目标、范围、责任或验收');
  const oldRevisions=previous.dependencyRevisions??[],revisions=next.dependencyRevisions??[];
  if(revisions.length<oldRevisions.length||revisions.length>oldRevisions.length+1||oldRevisions.some((record,index)=>stable(record)!==stable(revisions[index]))||previous.dependencyRevisions&&!next.dependencyRevisions)fail('GRAPH_INPUT_INVALID','前置修订审计只能追加，不能改删历史');
  if(revisions.length>oldRevisions.length&&changed)fail('GRAPH_INPUT_INVALID','修订前置不能同时修改任务目标、范围、责任或验收');
}

/**
 * 原子应用一个完整批次。连续内存投影中的已验证重复返回原引用；断档或同序号异内容拒绝。
 * 单独反序列化的 Snapshot 不含重放证明，旧批次会拒绝；应从日志重建或由游标读取补齐。
 * 返回值共享未变化对象；新增快照复制自批次，调用方不得把返回投影视为可变业务存储。
 */
export function applyGraphBatch(previous:GraphSnapshot|undefined,event:GraphEventBatch):GraphSnapshot {
  validateGraphBatch(event);
  const fingerprint=stable(event),seen=previous?seenBatches.get(previous):undefined;
  if(previous){
    assertGraphIdentity(previous.identity,event.identity);
    if(event.streamId!==previous.cursor.streamId)fail('GRAPH_STREAM_MISMATCH','事件流已变化，必须读取新快照');
    if(event.seq<=previous.cursor.seq){
      const known=seen?.get(event.seq);
      if(known?.fingerprint===fingerprint)return previous;
      fail('GRAPH_EVENT_CONFLICT',known?'相同图事件序号携带不同内容':'当前快照缺少旧事件的重放证明');
    }
    if(event.seq!==previous.cursor.seq+1)fail('GRAPH_SEQUENCE_GAP','图事件序号断档，需要补读');
    if(event.cause==='graph.created')fail('GRAPH_INPUT_INVALID','已经存在的图不能重复创建');
    if([...seen?.values()??[]].some(v=>v.eventId===event.eventId||v.commandId===event.commandId))fail('GRAPH_EVENT_CONFLICT','事件或命令身份已用于另一提交');
  }else if(event.seq!==1||event.cause!=='graph.created')fail('GRAPH_SEQUENCE_GAP','任务图必须从 graph.created 的第 1 批开始');
  const keys=event.changes.map(changeKey);if(new Set(keys).size!==keys.length)fail('GRAPH_INPUT_INVALID','同一批次不能多次更新同一对象');
  const tasks=new Map(previous?.tasks.map(t=>[t.taskId,t])??[]),edges=new Map(previous?.edges.map(e=>[e.edgeId,e])??[]),agents=new Map(previous?.agents.map(a=>[a.agentInstanceId,a])??[]);
  let root=previous?.root;
  for(const change of event.changes){
    switch(change.type){
      case 'root.upserted':{
        nextRevision(root,change.root);
        if(root&&(root.nodeId!==change.root.nodeId||root.createdAt!==change.root.createdAt||root.agent.agentId!==change.root.agent.agentId||root.agent.agentInstanceId!==change.root.agent.agentInstanceId||root.agent.agentSessionId!==change.root.agent.agentSessionId))fail('GRAPH_INPUT_INVALID','主会话根的绑定不能改写');
        root=structuredClone(change.root);break;
      }
      case 'task.upserted':{
        const old=tasks.get(change.task.taskId);nextRevision(old,change.task);
        if(old)taskRevision(old,change.task);
        else if(change.task.planRevision!==1||!['planned','queued','waiting'].includes(change.task.status)||change.task.runIds.length||change.task.result||change.task.help||change.task.cancelledBeforeStart||change.task.dependencyReplacements||change.task.dependencyAdditions||change.task.dependencyRevisions||change.task.checkpoints||change.task.resumeRequest||change.task.resumeHistory||change.task.checkpointAbandonment)fail('GRAPH_INPUT_INVALID','新任务必须从尚未执行的计划版本 1 创建');
        tasks.set(change.task.taskId,structuredClone(change.task));break;
      }
      case 'edge.upserted':{
        const old=edges.get(change.edge.edgeId);nextRevision(old,change.edge);
        if(old&&(old.kind!==change.edge.kind||old.fromNodeId!==change.edge.fromNodeId||old.toNodeId!==change.edge.toNodeId))fail('GRAPH_INPUT_INVALID','已有连线的类型和端点不能改写');
        if(old?.kind==='dependency'&&!old.enabled)fail('GRAPH_INPUT_INVALID','退役依赖不可重新启用或改写');
        edges.set(change.edge.edgeId,structuredClone(change.edge));break;
      }
      case 'agent.upserted':{
        const old=agents.get(change.agent.agentInstanceId);nextRevision(old,change.agent);
        if(old&&old.agentId!==change.agent.agentId)fail('GRAPH_INPUT_INVALID','成员实例不能改为其他角色');
        agents.set(change.agent.agentInstanceId,structuredClone(change.agent));break;
      }
    }
  }
  if(!root)fail('GRAPH_INPUT_INVALID','任务图缺少主会话根');
  const next:GraphSnapshot={version:1,identity:{...event.identity},cursor:{...event.identity,streamId:event.streamId,seq:event.seq},root,tasks:[...tasks.values()],edges:[...edges.values()],agents:[...agents.values()]};
  validateGraph(next);
  const history=new Map(seen);history.set(event.seq,{fingerprint,eventId:event.eventId,commandId:event.commandId});seenBatches.set(next,history);
  return next;
}

/**
 * 读取同一图的已提交增量；limit 按完整批次计数，no-op 不复制全图。
 * batches 是按 seq 连续、可选已压缩前缀的保留日志；缺口/乱序属于损坏，不能伪装成最新状态。
 */
export function readGraphDelta(snapshot:GraphSnapshot,batches:readonly GraphEventBatch[],cursor?:GraphCursor,limit=100):GraphDelta {
  if(!Number.isSafeInteger(limit)||limit<1||limit>500)fail('GRAPH_INPUT_INVALID','增量批次数必须为 1 至 500');
  const reset=(reason:'initial'|'stream_changed'|'cursor_ahead'|'history_compacted'):GraphDelta=>({mode:'reset',reason,snapshot,cursor:snapshot.cursor});
  if(!cursor)return reset('initial');
  validateGraphCursor(cursor);assertGraphIdentity(snapshot.identity,cursor);
  if(cursor.streamId!==snapshot.cursor.streamId)return reset('stream_changed');
  if(cursor.seq>snapshot.cursor.seq)return reset('cursor_ahead');
  if(cursor.seq===snapshot.cursor.seq)return {mode:'noop',cursor:snapshot.cursor};
  const first=batches[0]?.seq;
  if(first===undefined||cursor.seq<first-1)return reset('history_compacted');
  // 定位请求位置后，仅读取此次需要的批次；历史通常由存储在载入时完整校验。
  const start=cursor.seq+1-first;
  const selected=batches.slice(start,start+limit);
  if(!selected.length)fail('GRAPH_LOG_CORRUPT','图增量缺少已提交事件');
  let expected=cursor.seq+1;
  for(const event of selected){
    validateGraphBatch(event);assertGraphIdentity(snapshot.identity,event.identity);
    if(event.streamId!==snapshot.cursor.streamId||event.seq!==expected++||event.seq>snapshot.cursor.seq)fail('GRAPH_LOG_CORRUPT','图增量事件流或序号不连续');
  }
  const last=selected.at(-1)!.seq;
  if(last<snapshot.cursor.seq&&start+selected.length>=batches.length)fail('GRAPH_LOG_CORRUPT','图增量日志未到持久化头部');
  return {mode:'delta',from:cursor,cursor:{...snapshot.cursor,seq:last},batches:selected,hasMore:last<snapshot.cursor.seq};
}
