import assert from 'node:assert/strict';
import http from 'node:http';
import {goalPlanArguments,goalInspection,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';

export type WorkflowConditionMode='complete'|'missing-capability'|'stop'|'parallel-effects';
export const workflowConditionFixture={model:'workflow-condition-fixture',goal:'WORKFLOW_CONDITION_MAIN: 按保存的模块执行约定交付真实成果',memberGoal:'WORKFLOW_CONDITION_MEMBER: 计划前不可写入，实际读取后才能交付',file:'workflow-condition-result.txt',fact:'WORKFLOW_CONDITION_REAL_FILE_7e41c',parallelInitial:'WORKFLOW_PARALLEL_OLD_BYTES',parallelStarted:'workflow-parallel-started',parallelRelease:'workflow-parallel-release',acceptance:['按模块Workflow先计划再写入，并引用本轮实际read回执交付'],draft:'保留原会话普通草稿，Workflow校验不能发送它。',otherDraft:'另一个会话的独立草稿也应保留。',final:'模块Workflow的真实工具条件已核实，成员成果已完成主调度审阅。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function result(body:Request,id:string):any{const message=body.messages.find(value=>value.role==='tool'&&value.tool_call_id===id);assert.ok(message,'缺少真实工具返回 '+id);const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return {error:raw}}};let value=parse(text);if(Array.isArray(value.content))value=parse(value.content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join(''));return value}
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Model responses are local; saved workflows, permissions, approvals and every native file receipt are real. */
export async function workflowConditionProvider(mode:WorkflowConditionMode='complete'){
  const d=workflowConditionFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],beforePlan=gate(),beforeRead=gate();let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined;
  const state:{earlyWrite?:any;prematureDelivery?:any;delivery?:any;blockedTask?:unknown;parallelInspect?:any;staleStep?:any}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(value=>value.function.name==='cbim_dispatch_task')===true,turn=(isMain?main:member).length;(isMain?main:member).push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'workflow-condition-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const batch=(calls:Array<{id:string;name:string;args:unknown}>)=>{emit({role:'assistant',tool_calls:calls.map((call,index)=>({index,id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))});emit({},'tool_calls')},tool=(id:string,name:string,args:unknown)=>batch([{id,name,args}]),reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(value=>!['write','edit','bash'].includes(value.function.name)));
      if(turn===0){assert.ok(ownerSelection,'测试必须先通过真实登记/责任查询准备岗位选择');tool('workflow-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance,ownerSelection}))}
      else if(turn===1)tool('workflow-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已按真实模块Workflow派发执行任务。');
      else if(turn===3){if(mode==='missing-capability'){const source=JSON.stringify(body.messages);assert.ok(source.includes('当前权限或引擎未提供 Workflow 必需工具：write'),'主会话必须收到真实缺能力 limitation，不能只听模型假设');}tool('workflow-inspect','cbim_goal_inspect',{})}
      else if(turn===4){
        if(mode==='missing-capability'){const {scope,graph}=goalInspection(body,'workflow-inspect'),task=graph.tasks.find(value=>value.scopeId===scope.scopeId);assert.ok(task);assert.equal(task.result,undefined);assert.notEqual(task.status,'result_ready');state.blockedTask=task;tool('workflow-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(value=>({criterionId:value.id,outcome:'unmet',reason:'当前只读权限不具备模块Workflow要求的write能力',evidence:[]})),superseded:[],gaps:['需具备真实write能力及相应权限，不能凭模型自述完成'],reason:'成员启动前能力核验拒绝，未执行业务'})}
        else tool('workflow-review','cbim_goal_review',goalCompleteArguments(body,'workflow-inspect'));
      }else if(turn===5)reply(mode==='missing-capability'?'缺少实际执行能力，本目标没有完成。':d.final);
      else throw Error('Workflow fixture不允许重放主运行 '+turn);
    }else{
      assert.notEqual(mode,'missing-capability','缺实际工具能力时不得启动成员模型');
      if(mode==='parallel-effects'){
        if(turn===0)tool('parallel-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'核实真实并发工具的证据边界',steps:[{id:'verify',title:'写入并读取真实产物',owner:'开发者'}]});
        else if(turn===1)tool('parallel-initial-write','write',{path:d.file,content:d.parallelInitial});
        else if(turn===2){const script="const fs=require('fs');fs.writeFileSync('"+d.parallelStarted+"','started');const timer=setInterval(()=>{if(fs.existsSync('"+d.parallelRelease+"')){clearInterval(timer);fs.writeFileSync('"+d.file+"','"+d.fact+"');}},10);setTimeout(()=>process.exit(2),20000).unref()";batch([{id:'parallel-late-write',name:'bash',args:{command:'node -e "'+script+'"',timeout:30}},{id:'parallel-early-read',name:'read',args:{path:d.file}}])}
        else if(turn===3)tool('parallel-inspect','cbim_task_inspect',{});
        else if(turn===4){state.parallelInspect=result(body,'parallel-inspect');assert.ok(state.parallelInspect.plan);tool('parallel-stale-step','cbim_task_step',{expectedVersion:state.parallelInspect.plan.version,id:'verify',state:'reported_done',evidenceIds:['parallel-early-read']})}
        else if(turn===5){state.staleStep=result(body,'parallel-stale-step');assert.ok(state.staleStep.error,'早于副作用结束的read不得成为步骤证据');tool('parallel-fresh-read','read',{path:d.file})}
        else if(turn===6)tool('parallel-current-inspect','cbim_task_inspect',{});
        else if(turn===7){const current=result(body,'parallel-current-inspect');tool('parallel-final-step','cbim_task_step',{expectedVersion:current.plan.version,id:'verify',state:'reported_done',evidenceIds:['parallel-fresh-read']})}
        else if(turn===8){const step=result(body,'parallel-final-step');assert.equal(step.steps[0].state,'reported_done');tool('parallel-final-delivery','cbim_delivery_prepare',{expectedVersion:step.version,summary:'并发副作用结束后重新读取真实产物',limitations:['bash影响范围未知，工具事实不替代业务验收']})}
        else if(turn===9){state.delivery=result(body,'parallel-final-delivery');assert.equal(state.delivery.state,'awaiting_review');reply('只使用所有副作用结束后的新读取回执提交候选。')}
        else throw Error('Unexpected parallel Workflow replay '+turn);
      }else if(turn===0)tool('workflow-write-without-plan','write',{path:d.file,content:'THIS_MUST_NEVER_BE_WRITTEN'});
      else if(turn===1){state.earlyWrite=result(body,'workflow-write-without-plan');assert.match(String(state.earlyWrite.error),/WORKFLOW_PLAN_REQUIRED/);emit({role:'assistant',content:'计划前写入已被Workflow拒绝，尚未申请人工审批。'});await beforePlan.promise;tool('workflow-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'先建立本轮真实执行计划',steps:[{id:'verify',title:'写入并读取成果',owner:'开发者'}]})}
      else if(turn===2)tool('workflow-member-write','write',{path:d.file,content:d.fact});
      else if(turn===3)tool('workflow-only-write-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['workflow-member-write']});
      else if(turn===4)tool('workflow-premature-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:'只发生了write，尚未有Workflow要求的read',limitations:[]});
      else if(turn===5){state.prematureDelivery=result(body,'workflow-premature-delivery');assert.match(String(state.prematureDelivery.error),/WORKFLOW_EVIDENCE_REQUIRED/);emit({role:'assistant',content:'只有write证据的交付已被拒绝，接着读取实际文件。'});await beforeRead.promise;tool('workflow-member-read','read',{path:d.file})}
      else if(turn===6){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('workflow-valid-step','cbim_task_step',{expectedVersion:3,id:'verify',state:'reported_done',evidenceIds:['workflow-member-read']})}
      else if(turn===7)tool('workflow-valid-delivery','cbim_delivery_prepare',{expectedVersion:4,summary:'实际写入并读取 '+d.fact+'，引用本轮read回执',limitations:['工具调用事实不代替专业语义验收']});
      else if(turn===8){state.delivery=result(body,'workflow-valid-delivery');assert.equal(state.delivery.state,'awaiting_review');reply('真实读取回执已满足声明的Workflow条件，请主调度核实。')}
      else throw Error('Workflow fixture不允许重放成员 '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Workflow condition fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{beforePlan.release();beforeRead.release()};
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},releasePlan:()=>beforePlan.release(),releaseRead:()=>beforeRead.release(),releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
