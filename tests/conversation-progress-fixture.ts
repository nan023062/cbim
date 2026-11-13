import type {DispatchScope,GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';
import type {RunSummary} from '../src/bridge/contracts/execution';
import {summarizeScope} from '../src/logic/tasks/rules/scope-view';

export const progressIdentity={workspaceId:'a'.repeat(64),rootSessionId:'root'},progressTime='2026-11-09T06:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'main-channel',name:'主 Agent'};
/** Deterministic public fixtures, not a model-execution acceptance test. */
export function progressFixture(phase:number){
  const identity=progressIdentity,time=progressTime,seq=phase+1;
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'graph',seq},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[],edges:[],agents:[{agentId:main.agentId,agentInstanceId:main.agentInstanceId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}]};
  const scope:DispatchScope={scopeId:'scope-one',...identity,status:'active',createdAt:time,goal:{revision:phase===0?1:2,input:{message:'实现网页版中国象棋',attachmentIds:[]}}};
  if(phase>0)scope.goal!.plan={revision:2,runId:'main-run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:1},objective:'实现网页版中国象棋',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'验证棋子规则和交互'}],assignments:[{agentId:'executor',agentName:'规则执行员',teamId:'team',moduleIds:['rules'],moduleNames:['棋子规则'],criterionIds:['c1'],reason:'先实现规则，再接入界面'}],reason:'按依赖顺序实施'};
  if(phase>=2)for(let n=1;n<=2;n++){
    const id='member-'+n,hasRun=phase>=(n===1?3:4),done=phase>=(n===1?4:5),failed=n===2&&phase===6;
    const status:TaskNode['status']=failed?'failed':done?'result_ready':hasRun?'running':n===1?'queued':'waiting';
    const task:TaskNode={kind:'task',nodeId:'task:'+id,taskId:id,identity,scopeId:scope.scopeId,requester:main,assignee:{agentId:'executor',agentInstanceId:id,agentSessionId:id+'-session',name:n===1?'规则执行员':'界面执行员'},modules:[{moduleId:'rules',name:'棋子规则',knowledgeRevision:'knowledge',maintenanceBindingId:'maintenance',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'通用执行'}}],goal:n===1?'实现象棋走子规则':'接入棋盘交互',acceptance:[{id:'a',text:'验证真实结果'}],revision:seq,planRevision:1,status,awaitedChildren:[],runIds:hasRun?[id+'-run']:[],...(status==='running'?{activeRunId:id+'-run'}:{}),createdAt:time,updatedAt:time};
    if(status==='waiting')task.waitReason='等待规则任务返回候选';
    if(failed)task.waitReason='界面验证失败，需要修正交互';
    if(done&&!failed)task.result={resultId:id+'-result',runId:id+'-run',planRevision:1,summary:n===1?'规则已实现，测试回执已记录':'棋盘交互候选已返回',evidenceRefs:['read-result','test-result'],limitations:['尚待验收'],acceptance:'not_evaluated'};
    graph.tasks.push(task);graph.edges.push({edgeId:'dispatch-'+id,identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:task.nodeId,revision:1,enabled:true});
    graph.agents.push({agentId:'executor',agentInstanceId:id,name:task.assignee.name,revision:seq,state:status==='running'?'working':status==='waiting'?'waiting':'idle',...(status==='running'?{runningTaskId:id}:{}),waitingTaskIds:status==='waiting'?[id]:[]});
  }
  if(phase>=2)graph.edges.push({edgeId:'dependency',identity,kind:'dependency',fromNodeId:'task:member-1',toNodeId:'task:member-2',revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1,...(phase>=4?{resultId:'member-1-result'}:{})}});
  if(phase>=5){
    const decision=phase===5?'awaiting_user':phase===6?'blocked':'complete';
    scope.goal!.revision=3;scope.goal!.review={revision:3,planRevision:2,runId:'main-run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq},observedSeq:1,lastEffectSeq:0,decision,checks:[{criterionId:'c1',outcome:decision==='complete'?'satisfied':'unmet',reason:decision==='complete'?'已核对任务证据':'请核实棋盘交互体验',evidence:decision==='complete'?[{kind:'member-result',taskId:'member-2',runId:'member-2-run',resultId:'member-2-result',planRevision:1,toolCallIds:['test-result']}]:[]}],superseded:[],gaps:decision==='complete'?[]:['请确认是否需要增加悔棋功能'],reason:decision==='complete'?'依据成员候选申请完成':decision==='blocked'?'界面执行失败':'需要补充交互要求'};
    if(phase===5){scope.status='waiting';scope.wait={waitId:'wait',reason:'需要补充交互要求',createdAt:time,runId:'main-run',goalRevision:3,graphCursor:{streamId:'graph',seq},knowledgeRevision:'knowledge',mainRunIds:['main-run']}}
    if(phase===8){scope.status='closed';scope.outcome='completed';scope.closedAt=time}
  }
  return {identity,graph,scope,summary:summarizeScope(scope,'scopes:graph',seq)};
}
export function progressMemberRun(taskId:string,phase:number):RunSummary{
  const task=progressFixture(phase).graph.tasks.find(t=>t.taskId===taskId)!;
  const done=task.status==='result_ready',runId=taskId+'-run';
  return {task:{taskId,workspaceId:progressIdentity.workspaceId,root:'C:/fixture',goal:task.goal,moduleIds:['rules'],acceptance:['验证真实结果']},runId,status:done?'completed':'running',acceptance:'not_evaluated',unresolvedTools:[],taskProgress:{version:phase,goal:task.goal,acceptance:['验证真实结果'],reason:'核实执行证据',state:done?'awaiting_review':'executing',steps:[{id:'read',title:'核实已有规则',owner:task.assignee.name,state:'reported_done',evidence:['read']},{id:'implement',title:'实现并验证走子逻辑',owner:task.assignee.name,state:done?'reported_done':'working',evidence:done?['test']:[]}],...(done?{delivery:{summary:task.result!.summary,limitations:['尚待验收']}}:{})},events:Array.from({length:phase+1},(_,index)=>({version:1,seq:index+1,workspaceId:progressIdentity.workspaceId,taskId,runId,time:progressTime,type:index===0?'run.started':'engine.status',data:index===0?{message:task.goal}:{label:'公开活动 '+index}}))};
}
