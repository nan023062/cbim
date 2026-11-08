import http from 'node:http';
import assert from 'node:assert/strict';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {goalPlanArguments,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';
import type {ArtifactTransitionDefinition} from '../src/backend/core/workspace/artifact-scope';

export type CompleteOutputMode='automatic'|'changed'|'human';
export const completeOutputData={model:'complete-output-fixture',root:'outputs',file:'outputs/result.json',content:'{"count":1}',goal:'COMPLETE_OUTPUT_MAIN: 核实完整集合及JSON结构，按明确验收流程完成目标',memberGoal:'COMPLETE_OUTPUT_MEMBER: 生成真实JSON并以同一完整清单验证交付',acceptance:['冻结目录完整集合与JSON结构均已核实'],humanId:'full-human',humanCriterion:'请人工判断完整输出集合满足业务要求',draft:'保留普通草稿，完整验收不会发送此内容。',schema:{type:'object',properties:{count:{type:'integer',minimum:1}},required:['count'],additionalProperties:false}};
export const completeOutputTransitions:ArtifactTransitionDefinition[]=[{kind:'delete',path:'outputs/old.txt'},{kind:'move',from:'outputs/from.txt',to:'outputs/moved.txt'}];
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
const gate=()=>{let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}};
/** 仅模型响应确定；真实 Pi 写入、全集合枚举、JSON、候选和人工接续均由产品执行。 */
export async function completeOutputProvider(mode:CompleteOutputMode='automatic',transitions=false){
  const d=completeOutputData,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],review=gate(),continuation=gate(),state:{manifest?:any;validation?:any;delivery?:any;readyForReview?:boolean;review?:any;continuation?:any}={};let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined;
  const plan=(revision=1)=>{const p=goalPlanArguments({objective:d.goal,agentId,ownerSelection,moduleIds:[moduleId],acceptance:d.acceptance},revision);return mode==='human'?{...p,criteria:[...p.criteria,{id:d.humanId,text:d.humanCriterion,kind:'human'}],assignments:p.assignments.map(a=>({...a,criterionIds:[...a.criterionIds,d.humanId]}))}:p};
  const evidence=(task:any)=>{assert.equal(task.status,'result_ready');return {kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:task.result.evidenceRefs}};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(t=>t.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push((isMain?'main:':'member:')+turn);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'full-'+sequence.length,object:'chat.completion.chunk',created:1,model:d.model,choices:[{index:0,delta,finish_reason}]})+'\n\n'),tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      if(turn===0)tool('full-plan','cbim_goal_plan',plan());
      else if(turn===1)tool('full-dispatch','cbim_dispatch_task',{agentId,ownerSelection,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
      else if(turn===2)reply('已派发完整产物任务。');
      else if(turn===3)tool('full-inspect','cbim_goal_inspect',{});
      else if(turn===4){const {scope,graph}=mainToolValue(body,'full-inspect');state.readyForReview=true;emit({role:'assistant',content:'准备重核完整产物集合。'});await review.promise;tool('full-review','cbim_goal_review',mode==='human'?{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map((criterion:any)=>({criterionId:criterion.id,outcome:criterion.kind==='human'?'needs_human':'satisfied',reason:'核实原完整候选，业务判断须由人明确提交',evidence:[evidence(graph.tasks[0])]})),superseded:[],gaps:['等待明确人工决定'],reason:'保留原完整集合身份'}:goalCompleteArguments(body,'full-inspect'))}
      else if(turn===5){state.review=mainToolValue(body,'full-review');if(mode==='changed'){assert.ok(state.review.error);const {scope}=mainToolValue(body,'full-inspect');tool('full-blocked','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map((criterion:any)=>({criterionId:criterion.id,outcome:'unmet',reason:'完整集合新增文件，旧JSON字节不能覆盖新集合',evidence:[]})),superseded:[],gaps:['需要重新采集及验证完整集合'],reason:'保留原候选和验证事实，不重放旧业务'})}else{assert.equal(state.review.goal?.review?.decision,mode==='human'?'awaiting_user':'complete');reply(mode==='human'?'等待用户明确选择完整候选。':'完整集合及结构已核实。')}}
      else if(mode==='changed'&&turn===6){assert.equal(mainToolValue(body,'full-blocked').goal?.review?.decision,'blocked');reply('完整集合变化，原目标未完成。')}
      else if(mode==='human'&&turn===6){emit({role:'assistant',content:'已收到保存的完整人工接受，重新核实现状。'});await continuation.promise;tool('full-continued-inspect','cbim_goal_inspect',{})}
      else if(mode==='human'&&turn===7){const {scope}=mainToolValue(body,'full-continued-inspect');state.continuation=scope.continuations.at(-1);assert.equal(state.continuation.kind,'human_decisions');tool('full-continued-plan','cbim_goal_plan',plan(scope.goal.revision))}
      else if(mode==='human'&&turn===8)tool('full-final-inspect','cbim_goal_inspect',{});
      else if(mode==='human'&&turn===9){const {scope,graph}=mainToolValue(body,'full-final-inspect');tool('full-final-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map((criterion:any)=>({criterionId:criterion.id,outcome:'satisfied',reason:'重核同一原完整集合及本次消费的人工接受',evidence:criterion.kind==='human'?[{kind:'human-decision',decisionId:state.continuation.decisionIds[0],continuationId:state.continuation.continuationId}]:[evidence(graph.tasks[0])]})),superseded:[],gaps:[],reason:'按原完整身份完成复核'})}
      else if(mode==='human'&&turn===10){assert.equal(mainToolValue(body,'full-final-review').goal?.review?.decision,'complete');reply('完整产物与已消费人工接受核实通过。')}
      else throw Error('Unexpected complete main replay '+turn);
    }else if(transitions){
      assert.ok(body.tools?.some(t=>t.function.name==='cbim_artifact_transition'));
      const before=(id:string)=>mainToolValue(body,id).manifest.manifestId;
      if(turn===0)tool('full-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'真实原操作与完整集合共同交付',steps:[{id:'verify',title:'核实删除移动和JSON',owner:'开发者'}]});
      else if(turn===1)tool('full-write','write',{path:d.file,content:d.content});
      else if(turn===2)tool('full-before-read','read',{path:d.file});
      else if(turn===3)tool('full-before-capture','cbim_task_manifest_capture',{expectedTaskProgressVersion:2});
      else if(turn===4)tool('full-delete','cbim_artifact_transition',{moduleId,operationIndex:0,beforeManifestId:before('full-before-capture'),expectedTaskProgressVersion:2});
      else if(turn===5){assert.equal(mainToolValue(body,'full-delete').state,'applied');tool('full-middle-capture','cbim_task_manifest_capture',{expectedTaskProgressVersion:3})}
      else if(turn===6)tool('full-move','cbim_artifact_transition',{moduleId,operationIndex:1,beforeManifestId:before('full-middle-capture'),expectedTaskProgressVersion:3});
      else if(turn===7){assert.equal(mainToolValue(body,'full-move').state,'applied');tool('full-capture','cbim_task_manifest_capture',{expectedTaskProgressVersion:4})}
      else if(turn===8){state.manifest=mainToolValue(body,'full-capture').manifest;assert.equal(state.manifest.operations.length,2);tool('full-read','read',{path:d.file})}
      else if(turn===9)tool('full-json','cbim_validation_run',{moduleId,requirementId:'json',manifestId:state.manifest.manifestId,expectedTaskProgressVersion:4});
      else if(turn===10){state.validation=mainToolValue(body,'full-json').validation;assert.equal(state.validation?.outcome,'passed');assert.equal(state.validation.manifest.manifestId,state.manifest.manifestId);tool('full-step','cbim_task_step',{expectedVersion:4,id:'verify',state:'reported_done',evidenceIds:['full-read','full-json']})}
      else if(turn===11)tool('full-delivery','cbim_delivery_prepare',{expectedVersion:5,manifestId:state.manifest.manifestId,summary:'原删除移动与真实JSON的完整集合交付',limitations:['原操作及集合证明不代替人工业务判断']});
      else if(turn===12){state.delivery=mainToolValue(body,'full-delivery');assert.equal(state.delivery.state,'awaiting_review');assert.equal(state.delivery.delivery.workflow.manifest.operations.length,2);reply('包含原删除移动证明的完整候选已交付。')}
      else throw Error('Unexpected transition member replay '+turn);
    }else{
      assert.ok(body.tools?.some(t=>t.function.name==='cbim_task_manifest_capture'));assert.ok(body.tools?.some(t=>t.function.name==='cbim_validation_run'));
      if(turn===0)tool('full-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'生成真实JSON后固定完整集合',steps:[{id:'verify',title:'核实完整集合与JSON',owner:'开发者'}]});
      else if(turn===1)tool('full-write','write',{path:d.file,content:d.content});
      else if(turn===2)tool('full-read','read',{path:d.file});
      else if(turn===3)tool('full-capture','cbim_task_manifest_capture',{expectedTaskProgressVersion:2});
      else if(turn===4){state.manifest=mainToolValue(body,'full-capture').manifest;assert.ok(state.manifest?.manifestId);tool('full-json','cbim_validation_run',{moduleId,requirementId:'json',manifestId:state.manifest.manifestId,expectedTaskProgressVersion:2})}
      else if(turn===5){state.validation=mainToolValue(body,'full-json').validation;assert.equal(state.validation?.outcome,'passed');assert.equal(state.validation.manifest.manifestId,state.manifest.manifestId);tool('full-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['full-read','full-json']})}
      else if(turn===6)tool('full-delivery','cbim_delivery_prepare',{expectedVersion:3,manifestId:state.manifest.manifestId,summary:'真实JSON与完整集合同一身份交付',limitations:['结构与集合符合不代替人工业务判断']});
      else if(turn===7){state.delivery=mainToolValue(body,'full-delivery');assert.equal(state.delivery.state,'awaiting_review');assert.equal(state.delivery.delivery.workflow.manifest.manifestId,state.manifest.manifestId);reply('完整候选已交付。')}
      else throw Error('Unexpected complete member replay '+turn);
    }res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Complete output fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{review.release();continuation.release()};
  return {url:'http://127.0.0.1:'+address.port+'/v1',main,member,errors,sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},releaseReview:review.release,releaseContinuation:continuation.release,releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
