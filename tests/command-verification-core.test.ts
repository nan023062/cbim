import {expect,test} from 'vitest';
import {commandVerificationInputSchema,commandReportToolInputSchema,commandVerificationReportSchema,commandVerificationReportForInput,commandVerificationToolNames,commandReportToolName,isVerifiableMainToolName,type CommandVerificationReport,type VerifiableMainToolName} from '../src/backend/core/tasks/command-verification';
import {projectCommandReceipt} from '../src/backend/core/tasks/command-verification-output';
import {isProgressEvidence} from '../src/backend/core/tasks/member-tool-output';
import {evaluateWorkflowDelivery} from '../src/backend/core/tasks/workflow-evidence';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import {jsonToolResult} from '../src/backend/core/tools/results';
import {memberCandidate} from '../src/backend/scheduler-engine/execution/member-state';
import type {RunSummary} from '../src/backend/core/brain/types';
import type {TaskNode} from '../src/backend/core/tasks/graph-types';
import {mainToolOutputSchema,projectMainScope} from '../src/backend/core/tasks/main-tool-output';

const identity={workspaceId:'workspace',rootSessionId:'root',runId:'main-run',toolCallId:'original-call'};
const binding={workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,scopeId:'scope',runId:identity.runId};
const time='2026-11-08T10:00:00.000Z',digest='a'.repeat(64),commandId='original-command',cursor={streamId:'stream',seq:1},nextCursor={...cursor,seq:2};
const context={workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,scopeId:binding.scopeId,mainRunId:binding.runId,commandId};
const target={taskId:'target',expectedRevision:2,expectedPlanRevision:1},source={taskId:'source',expectedRevision:1,expectedPlanRevision:1};
const plan={expectedRevision:1,objective:'实际目标正文',constraints:['原始约束'],criteria:[{id:'criterion',text:'原始验收正文',kind:'evidence'}],assignments:[{agentId:'cbim:executor',moduleIds:['app'],criterionIds:['criterion'],reason:'原始分配说明'}],reason:'原始计划理由'};
function planned(){const {expectedRevision:_,...body}=plan;return {...context,commandId:undefined,mainRunId:undefined,status:'active',createdAt:time,runTracking:{version:1,mainRunIds:[binding.runId]},goal:{revision:2,input:{message:'原始目标',attachmentIds:[]},plan:{...body,assignments:body.assignments.map(value=>({...value,agentName:'原执行者',teamId:'team',moduleNames:['应用']})),revision:2,inputRevision:1,runId:binding.runId,recordedAt:time,knowledgeRevision:'knowledge',graphCursor:cursor}}}}
function cases():Array<{name:VerifiableMainToolName;input:any;raw:any}>{
  const plannedScope=planned();delete plannedScope.commandId;delete plannedScope.mainRunId;
  const review={expectedRevision:2,decision:'complete',checks:[{criterionId:'criterion',outcome:'satisfied',reason:'原成功知识记录',evidence:[{kind:'main-knowledge',toolCallIds:['read']}]}],superseded:[],gaps:[],reason:'原审阅申请'},reviewed=structuredClone(plannedScope);reviewed.goal.revision=3;
  Object.assign(reviewed.goal,{review:{decision:review.decision,checks:review.checks,superseded:[],gaps:[],reason:review.reason,revision:3,inputRevision:1,planRevision:2,runId:binding.runId,recordedAt:time,knowledgeRevision:'knowledge',graphCursor:cursor,observedSeq:10,lastEffectSeq:5}});
  const withSource={...source,runId:'source-run',resultId:'source-result'},common={expectedGraphCursor:cursor,expectedGoalRevision:2,target,reason:'明确修订'};
  const audit={commandId,scopeId:binding.scopeId,mainRunId:binding.runId,reason:common.reason,graphCursor:cursor,goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:2,targetPlanRevision:1,trackedTaskIds:['target','source']};
  return [
    {name:'cbim_goal_plan',input:plan,raw:plannedScope},{name:'cbim_goal_review',input:review,raw:reviewed},
    {name:'cbim_dispatch_task',input:{agentId:'cbim:executor'},raw:{commandId,taskId:'target',messageId:'assignment',cursor:{workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,...nextCursor},disposition:'queued'}},
    {name:'cbim_dispatch_cancel',input:{expectedGraphCursor:cursor,targets:[target],reason:'明确取消'},raw:{...context,cancelledTaskIds:['target'],graphCursor:nextCursor}},
    {name:'cbim_dispatch_replace_dependency',input:{...common,replace:{edgeId:'old-edge',expectedRevision:1},with:withSource},raw:{...context,taskId:'target',status:'queued',trackedTaskIds:audit.trackedTaskIds,replacement:{...audit,replacedAt:time,retired:{edgeId:'old-edge',revision:1,sourceTaskId:'old-task',sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:source.taskId,sourceTaskRevision:1,sourcePlanRevision:1,runId:withSource.runId,resultId:withSource.resultId}},graphCursor:nextCursor}},
    {name:'cbim_dispatch_add_dependency',input:{...common,source},raw:{...context,taskId:'target',status:'waiting',trackedTaskIds:audit.trackedTaskIds,addition:{...audit,addedAt:time,dependency:{edgeId:'added-edge',sourceTaskId:source.taskId,sourceTaskRevision:1,sourcePlanRevision:1}},graphCursor:nextCursor}},
    {name:'cbim_dispatch_resume',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,taskId:'target',expectedRevision:2,expectedPlanRevision:1,checkpointId:'checkpoint',reason:'明确预约'},raw:{taskId:'target',checkpointId:'checkpoint',requestId:'reservation',trackedTaskIds:['target','source'],cursor:{workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,...nextCursor}}},
    {name:'cbim_dispatch_abandon_checkpoint',input:{expectedGraphCursor:cursor,expectedGoalRevision:2,taskId:'target',expectedRevision:2,expectedPlanRevision:1,checkpointId:'checkpoint',expectedResumeRequestId:null,reason:'明确放弃'},raw:{...context,taskId:'target',status:'cancelled',graphCursor:nextCursor,abandonment:{kind:'abandoned_by_handoff',commandId,scopeId:binding.scopeId,mainRunId:binding.runId,graphCursor:cursor,goalRevision:2,previousTaskRevision:2,planRevision:1,checkpointId:'checkpoint',sourceRunId:'source-run',resumeRequestId:null,previousLeaseEpoch:1,nextLeaseEpoch:2,reason:'明确放弃',abandonedAt:time}}},
  ];
}
function report():CommandVerificationReport{return {version:1,identity,checkedAt:time,basis:{key:digest,adapterVersion:1,logPrefixHash:digest,throughSeq:8},consistency:'stable',source:{state:'verified',toolName:'cbim_dispatch_task',runStatus:'completed',proposedSeq:2,allowedSeq:3,finishedSeq:5,inputHash:digest,outcome:'failed'},command:{state:'committed',commandId,requestFingerprint:digest,receiptHash:digest,commit:{transactionSeq:2,checksum:digest,executionProtocol:'legacy'},result:{toolName:'cbim_dispatch_task',taskId:'target',messageId:'assignment',cursor:{workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId,...nextCursor},disposition:'queued'}},scope:{scopeId:'scope',status:'closed',outcome:'interrupted'},issues:[],readOnly:true,acceptance:'not_evaluated'}}

test('请求只选择原调用，合法旧首字符保留；模型不能注入scope/command或workspace',()=>{
  expect(commandVerificationInputSchema.parse({...identity,workspaceId:'_workspace',rootSessionId:'-root'}).workspaceId).toBe('_workspace');
  for(const field of ['scopeId','commandId','fingerprint','toolName','actor','receipt','input'])expect(commandVerificationInputSchema.safeParse({...identity,[field]:'forged'}).success).toBe(false);
  expect(commandReportToolInputSchema.safeParse({runId:'run',toolCallId:'call',workspaceId:'another'}).success).toBe(false);
  expect(commandVerificationToolNames).toHaveLength(8);expect(isVerifiableMainToolName('constructor')).toBe(false);expect(isVerifiableMainToolName(commandReportToolName)).toBe(false);
});

test.each(cases())('$name 完整原回执按原身份及输入核实后仅公开紧凑事实',({name,input,raw})=>{
  const publicValue=name==='cbim_goal_plan'||name==='cbim_goal_review'?projectMainScope(raw):raw;
  const checked=mainToolOutputSchema(name,{binding,input,expectedCommandId:commandId}).safeParse(publicValue);
  expect(JSON.stringify(checked.success?null:checked.error.issues)).toBe('null');if(checked.success)expect(checked.data).toEqual(publicValue);
  const frozen=structuredClone(raw),value=projectCommandReceipt(name,raw,{binding,input,expectedCommandId:commandId});expect(value.toolName).toBe(name);expect(raw).toEqual(frozen);
  expect(JSON.stringify(value)).not.toContain('原始');expect(value).not.toHaveProperty('goal');expect(value).not.toHaveProperty('ownerBinding');
  expect(()=>projectCommandReceipt(name,raw,{binding:{...binding,rootSessionId:'foreign'},input,expectedCommandId:commandId})).toThrow(expect.objectContaining({code:'COMMAND_RECEIPT_INVALID'}));
});

test('完整未知私有回执不透传，畸形结构/字段改写不被摘要修复',()=>{
  const one=cases().find(value=>value.name==='cbim_goal_plan')!,scope=one.raw;const id='e4035ae5-1f63-4a1f-9c49-f69896f9cfbd';scope.scopeId=id;
  scope.recovery={recoveryId:id,acceptedAt:time,source:{scopeId:'source-scope',taskId:'source-task',runId:'source-run',reportBasis:digest,taskRevision:2,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'missing',unknownToolCount:1},operation:'inspect_effects',observation:{text:'只核实原事实'},input:{message:scope.goal.input.message},options:{provider:'provider',model:'model',profileId:'70bf879b-f51f-4c46-8cb6-58b14197a69c',permission:'read'},context:{initialRunId:binding.runId,nativeSessionId:'6e7a687c-23fb-438e-9934-53c013b8f9d0',excludedRunIds:['private-old-run']}};
  const value=projectCommandReceipt(one.name,scope,{binding:{...binding,scopeId:id},input:one.input,expectedCommandId:commandId});expect(JSON.stringify(value)).not.toContain('native');expect(JSON.stringify(value)).not.toContain('private-old-run');
  scope.goal.plan.reason=' '+scope.goal.plan.reason;expect(()=>projectCommandReceipt(one.name,scope,{binding:{...binding,scopeId:id},input:one.input,expectedCommandId:commandId})).toThrow(expect.objectContaining({code:'COMMAND_RECEIPT_INVALID'}));
  const dispatch=cases()[2];for(const raw of [null,{}, {...dispatch.raw,Prepared:{apiKey:'secret'}},{...dispatch.raw,commandId:'another'}])expect(()=>projectCommandReceipt(dispatch.name,raw,{binding,input:dispatch.input,expectedCommandId:commandId})).toThrow(expect.objectContaining({code:'COMMAND_RECEIPT_INVALID'}));
});

test('摘要最多20个并明确数量，完整原集合仍先核请求而不静默裁剪',()=>{
  const c=cases().find(value=>value.name==='cbim_dispatch_cancel')!;const ids=Array.from({length:30},(_,index)=>'task-'+index);c.input.targets=ids.map(taskId=>({taskId,expectedRevision:1}));c.raw.cancelledTaskIds=ids;
  const r=projectCommandReceipt(c.name,c.raw,{binding,input:c.input,expectedCommandId:commandId});expect(r).toMatchObject({cancelled:{total:30,truncated:true,taskIds:ids.slice(0,20)}});c.raw.cancelledTaskIds[29]='foreign-task';expect(()=>projectCommandReceipt(c.name,c.raw,{binding,input:c.input,expectedCommandId:commandId})).toThrow();
});

test('failed工具与committed命令合法并存；坏身份/伪完成/缺依据/错序均拒',()=>{
  expect(commandVerificationReportSchema.safeParse(report()).success).toBe(true);
  for(const mutate of [(r:any)=>r.acceptance='accepted',(r:any)=>r.source.state='missing',(r:any)=>delete r.scope,(r:any)=>delete r.source.allowedSeq,(r:any)=>r.source.finishedSeq=2,(r:any)=>r.basis.throughSeq=1,(r:any)=>r.consistency='changed_during_read',(r:any)=>r.command.result.cursor.rootSessionId='foreign',(r:any)=>r.command.receipt={Prepared:'secret'},(r:any)=>r.command.result.toolName='cbim_goal_plan']){const r=report();mutate(r);expect(commandVerificationReportSchema.safeParse(r).success).toBe(false)}
  for(const field of ['workspaceId','rootSessionId','runId','toolCallId'] as const){const r=report();r.identity={...identity,[field]:'different'};expect(commandVerificationReportForInput(identity).safeParse(r).success).toBe(false)}
  const absent={...report(),command:{state:'absent',commandId}};expect(commandVerificationReportSchema.safeParse(absent).success).toBe(true);expect(commandVerificationReportSchema.safeParse({...absent,command:{state:'absent',commandId,unaccepted:true}}).success).toBe(false);
  expect(commandVerificationReportSchema.safeParse({...absent,source:{...absent.source,toolName:'bash'}}).success).toBe(false);
  const unsupported={...report(),source:{...report().source,toolName:'bash'},command:{state:'not_applicable',reason:'unsupported_family'}};expect(commandVerificationReportSchema.safeParse(unsupported).success).toBe(true);expect(commandVerificationReportSchema.safeParse({...unsupported,command:{state:'not_applicable',reason:'readonly_tool'}}).success).toBe(false);
});

test('报告成功不能作为步骤、Workflow或候选成果；未引用报告不阻真read证据',()=>{
  const who={workspaceId:'workspace',taskId:'task',runId:'run'},decision={allow:true as const,effects:['read' as const],scope:{kind:'workspace' as const,workspaceId:'workspace'}};
  const receipt=(name:string,id:string)=>toolReceipt(who,{id,name,input:{}},decision,'succeeded',jsonToolResult(name,{result:'fact'}));const query=receipt(commandReportToolName,'query'),read=receipt('read','read');
  expect(isProgressEvidence(query,who)).toBe(false);expect(isProgressEvidence(read,who)).toBe(true);expect(()=>evaluateWorkflowDelivery([], [query],who)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));expect(()=>evaluateWorkflowDelivery([], [read],who)).not.toThrow();
  const task={taskId:'task',identity:{workspaceId:'workspace',rootSessionId:'root'},goal:'目标',acceptance:[{id:'a',text:'真实读取'}],planRevision:1} as TaskNode;
  const summary={task:{workspaceId:'workspace',taskId:'task',root:'/fixture',agentId:'agent',moduleIds:[],goal:task.goal,acceptance:['真实读取']},runId:'run',status:'completed',acceptance:'not_evaluated',events:[],unresolvedTools:[],toolReceipts:[query,read],taskProgress:{version:3,goal:task.goal,acceptance:['真实读取'],reason:'实现目标',steps:[{id:'step',title:'读取成果',owner:'executor',state:'reported_done',evidence:['query']}],state:'awaiting_review',delivery:{summary:'真实成果',limitations:[]}}} as RunSummary;
  expect(memberCandidate(task,summary)).toBeUndefined();summary.taskProgress!.steps[0].evidence=['read'];expect(memberCandidate(task,summary)?.evidenceRefs).toEqual(['read']);
});
