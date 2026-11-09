import type {RunSummary} from '../src/bridge/contracts/execution';
import {progressFixture,progressIdentity,progressTime} from './conversation-progress-fixture';

/** Persisted-shape synthetic events, not proof of a real model dispatch. */
export function inlineMainRuns(phase:number):RunSummary[]{
  const {graph}=progressFixture(phase),{workspaceId,rootSessionId}=progressIdentity;
  const base:RunSummary={task:{taskId:rootSessionId,workspaceId,root:'C:/fixture',goal:'中国象棋',moduleIds:[],acceptance:[],mode:'chat',agentId:'cbim:main'},runId:'main-run',status:phase<2?'running':'completed',acceptance:'not_evaluated',unresolvedTools:[],conversationBinding:{workspaceId,rootSessionId,teamId:'team',agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'main-channel'},events:[]};
  const event=(run:RunSummary,type:RunSummary['events'][number]['type'],data:Record<string,unknown>)=>run.events.push({version:1,seq:run.events.length+1,workspaceId,taskId:rootSessionId,runId:run.runId,time:progressTime,type,data});
  event(base,'run.started',{message:'实现网页版中国象棋'});
  event(base,phase===0?'message.delta':'message',{text:phase===0?'先分析棋子':'先把规则引擎拆成一个任务。'});
  if(phase>=1)event(base,'tool.finished',{id:'plan',name:'cbim_goal_plan',result:{content:[{type:'text',text:'目标计划已保存'}]}});
  if(phase>=2){
    for(const task of graph.tasks){
      const id='dispatch-'+task.taskId,input={agentId:task.assignee.agentId,moduleIds:['rules'],goal:task.goal};
      event(base,'tool.proposed',{id,name:'cbim_dispatch_task',input});event(base,'tool.started',{id,name:'cbim_dispatch_task'});
      const receipt={version:1,toolCallId:id,toolName:'cbim_dispatch_task',workspaceId,taskId:rootSessionId,runId:base.runId,outcome:'succeeded',inputHash:'a'.repeat(64),resultHash:'b'.repeat(64),effects:['maintenance'],scope:{kind:'knowledge',workspaceId},recordedAt:progressTime};
      const result={content:[{type:'text',text:JSON.stringify({commandId:'cmd-'+id,taskId:task.taskId,messageId:'msg-'+id,cursor:{...progressIdentity,streamId:'graph',seq:3},disposition:task.taskId==='member-1'?'queued':'waiting'})}]};
      event(base,'tool.finished',{id,name:'cbim_dispatch_task',result,receipt});
      event(base,'message',{text:task.taskId==='member-1'?'接下来派发棋盘交互，等待规则候选。':'已派发，等待成员回传后继续处理。'});
    }
    event(base,'run.settled',{status:'completed'});
  }
  if(phase<4)return [base];
  const returned:RunSummary={...base,runId:'returned-run',source:{kind:'member-results',continuationId:'continuation',messageIds:['result-message'],taskIds:['member-1']},events:[]};
  event(returned,'run.started',{source:returned.source,message:'内部转交内容不应冒充用户'});
  event(returned,'message',{text:'已收到规则候选，继续核实棋盘交互。'});
  if(phase>=5)event(returned,'tool.finished',{id:'review',name:'cbim_goal_review',result:{content:[{type:'text',text:phase===5?'等待用户补充':phase===6?'目标受阻':'完成申请待复核'}]}});
  event(returned,'run.settled',{status:'completed'});
  return [base,returned];
}
