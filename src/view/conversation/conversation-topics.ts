/**
 * 作用定位：将主会话公开运行和派发任务投影为话题内容，供群聊导航使用。
 * 设计原因：归属只看持久主运行清单、可信接续来源或原任务 scopeId；迟到反馈不随当前选择移动，旧无归属日志保持未分类。
 * 职责边界：不保存正文副本、不调度或暂停、不按时间和文字猜测任务关系。
 */
import type {GraphIdentity,GraphSnapshot,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import type {RunSummary} from '../../bridge/contracts/execution';

export interface ConversationTopic {scope:ScopeSummary;runs:RunSummary[];tasks:TaskNode[];archived:boolean}
/** 返回所属办公室的只读分组；冲突归属保留在未分类集合，不任选一个话题。 */
export function conversationTopics(identity:GraphIdentity,scopes:readonly ScopeSummary[],runs:readonly RunSummary[],graph?:GraphSnapshot){
  const local=graph?.identity.workspaceId===identity.workspaceId&&graph.identity.rootSessionId===identity.rootSessionId?graph:undefined;
  const topics:ConversationTopic[]=scopes.map(scope=>({scope,runs:[],tasks:local?.tasks.filter(task=>task.scopeId===scope.scopeId)??[],archived:scope.status==='closed'&&['completed','cancelled'].includes(scope.outcome??'')}));
  const unassigned:RunSummary[]=[],conflicts:string[]=[];
  for(const run of runs){
    if(run.task.workspaceId!==identity.workspaceId||run.task.taskId!==identity.rootSessionId||run.task.mode!=='chat'||run.memberBinding)continue;
    let candidates=topics.filter(topic=>topic.scope.mainRunIds?.includes(run.runId));
    if(!candidates.length&&run.source){
      if('scopeId' in run.source){const scopeId=run.source.scopeId;candidates=topics.filter(topic=>topic.scope.scopeId===scopeId)}
      else if(run.source.kind==='member-results'){
        const taskIds=run.source.taskIds,tasks=taskIds.map(id=>local?.tasks.find(task=>task.taskId===id));
        const ids=new Set(tasks.map(task=>task?.scopeId));
        if(taskIds.length&&tasks.every(Boolean)&&ids.size===1&&!ids.has(undefined))candidates=topics.filter(topic=>ids.has(topic.scope.scopeId));
      }
    }
    if(candidates.length===1)candidates[0].runs.push(run);
    else {unassigned.push(run);if(candidates.length>1)conflicts.push(run.runId)}
  }
  return {topics,unassigned,conflicts};
}
