import assert from 'node:assert/strict';
import http from 'node:http';
import {goalPlanArguments,goalInspection,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';

export type JsonValidationMode='complete'|'changed'|'stop'|'human-negative';
export const jsonValidationFixture={
  model:'json-validation-fixture',goal:'JSON_VALIDATION_MAIN: 交付按冻结Schema验证的真实JSON文件',memberGoal:'JSON_VALIDATION_MEMBER: 修正JSON结构并用当前文件字节验证后交付',
  file:'validation-result.json',requirementId:'json-result',bad:JSON.stringify({name:'测试产物',count:'not-an-integer'}),good:JSON.stringify({name:'测试产物',count:2}),changed:JSON.stringify({name:'外部改动',count:3}),
  acceptance:['真实JSON满足模块冻结的结构约束，交付引用本轮通过的文件验证'],draft:'保留普通草稿；结构验证不代表人工业务验收。',humanId:'json-human-review',humanCriterion:'请人工判断该JSON成果是否满足业务展示要求',
  schema:{type:'object',required:['name','count'],properties:{name:{type:'string',minLength:1},count:{type:'integer',minimum:1}},additionalProperties:false},
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Real product write/read/capture/validator calls; only localhost model responses and explicit pauses are scripted. */
export async function jsonValidationProvider(mode:JsonValidationMode='complete'){
  const d=jsonValidationFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],repair=gate(),review=gate();let agentId='',moduleId='',workflowId:string|undefined;
  const state:{badProgress?:any;badCapture?:any;rejected?:any;badStep?:any;deniedDelivery?:any;freshProgress?:any;freshCapture?:any;passed?:any;freshStep?:any;delivery?:any;readyForReview?:boolean;reviewInput?:any;reviewError?:any}={};
  const selection=()=>workflowId?{workflowSelections:[{moduleId,workflowId}]}:{};
  const goalPlan=(expectedRevision=1)=>{const original=goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance},expectedRevision),plan={...original,assignments:original.assignments.map(item=>({...item,...selection()}))};return mode==='human-negative'?{...plan,criteria:[...plan.criteria,{id:d.humanId,text:d.humanCriterion,kind:'human'}],assignments:plan.assignments.map(item=>({...item,criterionIds:[...item.criterionIds,d.humanId]}))}:plan};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true,list=isMain?main:member,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'json-validation-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n'),tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(item=>!['cbim_validation_run','write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('json-goal-plan','cbim_goal_plan',goalPlan());
      else if(turn===1)tool('json-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],...selection(),goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已交给独立成员按冻结JSON结构要求验证。');
      else if(turn===3)tool('json-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4){
        if(mode==='human-negative'){const {scope,graph}=goalInspection(body,'json-goal-inspect'),task=graph.tasks.find(value=>value.scopeId===scope.scopeId);assert.equal(task?.status,'result_ready');assert.ok(task.result);const evidence={kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:task.result.evidenceRefs};state.reviewInput={expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:criterion.kind==='human'?'needs_human':'satisfied',reason:criterion.kind==='human'?'须用户明确决定业务成果':'结构与当前字节证据已核实',evidence:[evidence]})),superseded:[],gaps:['需要用户对当前真实成果作出明确人工决定'],reason:'结构验证通过并不代替业务人工验收'}}else state.reviewInput=goalCompleteArguments(body,'json-goal-inspect');
        state.readyForReview=true;emit({role:'assistant',content:'已收到真实候选，准备复核当前文件与验证证据。'});await review.promise;tool('json-goal-review','cbim_goal_review',state.reviewInput)
      }
      else if(turn===5&&mode==='changed'){
        state.reviewError=mainToolValue(body,'json-goal-review');assert.ok(state.reviewError.error,'外部改动必须让真实主审阅拒绝，不能仍存complete');const {scope}=goalInspection(body,'json-goal-inspect');tool('json-blocked-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'已验证文件在主审阅之前被外部改动，旧字节证明不再适用',evidence:[]})),superseded:[],gaps:['需针对实际新文件重新执行，不自动重放旧操作'],reason:'保留旧验证记录，拒绝将旧passed套用新字节'})
      }else if(turn===(mode==='changed'?6:5))reply(mode==='changed'?'文件已变化，原目标未完成；旧验证只是历史事实。':mode==='human-negative'?'原目标等待用户对真实JSON候选作出决定；保存意见不继续执行。':'真实JSON结构验证和当前字节已核实，仍不代替人工业务语义验收。');
      else if(mode==='human-negative'&&turn===6)tool('json-human-continued-inspect','cbim_goal_inspect',{});
      else if(mode==='human-negative'&&turn===7){const {scope}=mainToolValue(body,'json-human-continued-inspect');assert.equal(scope.continuations?.at(-1)?.kind,'human_decisions');tool('json-human-continued-plan','cbim_goal_plan',goalPlan(scope.goal.revision))}
      else if(mode==='human-negative'&&turn===8){const scope=mainToolValue(body,'json-human-continued-plan');assert.ok(scope.goal?.plan);tool('json-human-continued-blocked','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map((criterion:any)=>({criterionId:criterion.id,outcome:'unmet',reason:'收到真实人工负面意见，当前文件已改变，不能使用旧通过记录完成目标',evidence:[]})),superseded:[],gaps:['需重新安排实际产物工作，本测试不虚构返工或通过'],reason:'负面意见接续已进入主调度，但原目标尚未完成'})}
      else if(mode==='human-negative'&&turn===9){const scope=mainToolValue(body,'json-human-continued-blocked');assert.equal(scope.goal?.review?.decision,'blocked');reply('负面意见已接续到主调度，保留旧候选及验证历史；本轮没有重新执行业务或批准成果。')}
      else throw Error('Unexpected main replay '+turn);
    }else{
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_validation_run'),'真实冻结要求必须装配验证工具');
      if(turn===0)tool('json-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'严格按冻结Schema验证当前文件，不以工具调用成功替代结构通过',steps:[{id:'verify',title:'验证真实JSON结构及当前字节',owner:'开发者'}]});
      else if(turn===1)tool('json-bad-write','write',{path:d.file,content:d.bad});
      else if(turn===2)tool('json-bad-read','read',{path:d.file});
      else if(turn===3)tool('json-bad-inspect','cbim_task_inspect',{});
      else if(turn===4){state.badProgress=mainToolValue(body,'json-bad-inspect');assert.ok(Number.isInteger(state.badProgress.plan?.version));tool('json-bad-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.badProgress.plan.version,sourceToolCallIds:['json-bad-read']})}
      else if(turn===5){state.badCapture=mainToolValue(body,'json-bad-capture');assert.equal(state.badCapture.state,'captured');tool('json-bad-validation','cbim_validation_run',{moduleId,requirementId:d.requirementId,baselineId:state.badCapture.baseline.baselineId,expectedTaskProgressVersion:state.badProgress.plan.version})}
      else if(turn===6){state.rejected=mainToolValue(body,'json-bad-validation');assert.equal(state.rejected.state,'checked');assert.equal(state.rejected.validation.outcome,'rejected');assert.ok(state.rejected.validation.issues.length>0);tool('json-bad-step','cbim_task_step',{expectedVersion:state.badProgress.plan.version,id:'verify',state:'reported_done',evidenceIds:['json-bad-read','json-bad-validation']})}
      else if(turn===7){state.badStep=mainToolValue(body,'json-bad-step');assert.equal(state.badStep.steps?.[0].state,'reported_done');tool('json-bad-delivery','cbim_delivery_prepare',{expectedVersion:state.badStep.version,summary:'真实结构验证已执行，但结果rejected，不能当通过',limitations:[]})}
      else if(turn===8){state.deniedDelivery=mainToolValue(body,'json-bad-delivery');assert.match(String(state.deniedDelivery.error),/WORKFLOW_VALIDATION_REQUIRED/);emit({role:'assistant',content:'JSON结构不合格，交付已被拒绝；准备修复并重新读取采集验证。'});await repair.promise;tool('json-good-write','write',{path:d.file,content:d.good})}
      else if(turn===9)tool('json-good-read','read',{path:d.file});
      else if(turn===10)tool('json-fresh-inspect','cbim_task_inspect',{});
      else if(turn===11){state.freshProgress=mainToolValue(body,'json-fresh-inspect');assert.ok(state.freshProgress.plan.version>state.badStep.version);assert.ok(state.freshProgress.plan.steps.every((step:{evidence:string[]})=>step.evidence.length===0));assert.ok(state.freshProgress.evidence.every((item:{toolCallId:string})=>!item.toolCallId.startsWith('json-bad-')));tool('json-good-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.freshProgress.plan.version,sourceToolCallIds:['json-good-read']})}
      else if(turn===12){state.freshCapture=mainToolValue(body,'json-good-capture');assert.equal(state.freshCapture.state,'captured');tool('json-good-validation','cbim_validation_run',{moduleId,requirementId:d.requirementId,baselineId:state.freshCapture.baseline.baselineId,expectedTaskProgressVersion:state.freshProgress.plan.version})}
      else if(turn===13){state.passed=mainToolValue(body,'json-good-validation');assert.equal(state.passed.state,'checked');assert.equal(state.passed.validation.outcome,'passed');assert.deepEqual(state.passed.validation.issues,[]);tool('json-good-step','cbim_task_step',{expectedVersion:state.freshProgress.plan.version,id:'verify',state:'reported_done',evidenceIds:['json-good-read','json-good-validation']})}
      else if(turn===14){state.freshStep=mainToolValue(body,'json-good-step');assert.equal(state.freshStep.steps?.[0].state,'reported_done');tool('json-good-delivery','cbim_delivery_prepare',{expectedVersion:state.freshStep.version,summary:'实际JSON当前字节符合冻结结构Schema',limitations:['结构合格不表示业务目标或人工验收通过']})}
      else if(turn===15){state.delivery=mainToolValue(body,'json-good-delivery');assert.equal(state.delivery.state,'awaiting_review');assert.ok(state.delivery.delivery.workflow.validationChecks.length>0);reply('已提交真实结构验证候选，请主调度复核当前文件字节。')}
      else throw Error('Unexpected member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('JSON validation fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{repair.release();review.release()};return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,state,bind:(agent:string,module:string,selectedWorkflow?:string)=>{agentId=agent;moduleId=module;workflowId=selectedWorkflow},releaseRepair:repair.release,releaseReview:review.release,releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
