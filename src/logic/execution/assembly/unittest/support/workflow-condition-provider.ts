import assert from 'node:assert/strict';
import http from 'node:http';
import {type GoalFixtureRequest} from '../../../../tasks/rules/unittest/support/goal-provider-fixture';
import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';

export type WorkflowConditionMode='complete'|'missing-capability'|'stop'|'parallel-effects';
export const workflowConditionFixture={model:'workflow-condition-fixture',goal:'WORKFLOW_CONDITION_MAIN: 按保存的模块执行约定交付真实成果',memberGoal:'WORKFLOW_CONDITION_MEMBER: 计划前不可写入，实际读取后才能交付',file:'workflow-condition-result.txt',fact:'WORKFLOW_CONDITION_REAL_FILE_7e41c',parallelInitial:'WORKFLOW_PARALLEL_OLD_BYTES',parallelStarted:'workflow-parallel-started',parallelRelease:'workflow-parallel-release',acceptance:['按模块Workflow先计划再写入，并引用本轮实际read回执交付'],draft:'保留原会话普通草稿，Workflow校验不能发送它。',otherDraft:'另一个会话的独立草稿也应保留。',final:'模块Workflow的真实工具条件已核实，成员成果已完成主调度审阅。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function result(body:Request,id:string):any{const message=body.messages.find(value=>value.role==='tool'&&value.tool_call_id===id);assert.ok(message,'缺少真实工具返回 '+id);const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return {error:raw}}};let value=parse(text);if(Array.isArray(value.content))value=parse(value.content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join(''));return value}
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Model responses are local; saved workflows, permissions, approvals and every native file receipt are real. */
export async function workflowConditionProvider(mode:WorkflowConditionMode='complete'){
  const d=workflowConditionFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[],beforePlan=gate(),beforeRead=gate();let moduleId='',ownerSelection:OwnerExecutionSelection|undefined;
  const state:{earlyWrite?:any;prematureDelivery?:any;delivery?:any;call?:any;check?:any;parallelInspect?:any;staleStep?:any}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(value=>value.function.name==='cbim_agent_result_review')===true,turn=(isMain?main:member).length;(isMain?main:member).push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'workflow-condition-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const batch=(calls:Array<{id:string;name:string;args:unknown}>)=>{emit({role:'assistant',tool_calls:calls.map((call,index)=>({index,id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))});emit({},'tool_calls')},tool=(id:string,name:string,args:unknown)=>batch([{id,name,args}]),reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(value=>!['cbim_task_help','cbim_task_checkpoint'].includes(value.function.name)));
      if(turn===0){assert.ok(ownerSelection);tool('workflow-call','cbim_agent_call',{agentId:ownerSelection.memberId,message:d.memberGoal,business:{moduleIds:[moduleId],acceptance:d.acceptance}})}
      else if(turn===1){
        state.call=result(body,'workflow-call');
        if(mode==='missing-capability'){assert.match(JSON.stringify(state.call),/WORKFLOW_TOOL_UNAVAILABLE/);assert.equal(state.call.error.started,false);reply('缺少实际执行能力；原调用未启动，没有完成业务任务。')}
        else{assert.equal(state.call.status,'completed');assert.equal(state.call.verification.state,'verified');tool('workflow-check','cbim_agent_result_check',{callId:'workflow-call'})}
      }else if(turn===2){state.check=result(body,'workflow-check');assert.equal(state.check.state,'verified');reply('原调用的 Workflow 工具条件已核实，仍未进行人工业务验收。')}
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
      else if(turn===1){state.earlyWrite=result(body,'workflow-write-without-plan');assert.equal(state.earlyWrite.code,'WORKFLOW_PLAN_REQUIRED');assert.match(String(state.earlyWrite.message),/先保存.*执行计划/);assert.equal(state.earlyWrite.status,'rejected');assert.equal(state.earlyWrite.retryable,false);emit({role:'assistant',content:'计划前写入已被Workflow拒绝，尚未申请人工审批。'});await beforePlan.promise;tool('workflow-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'先建立本轮真实执行计划',steps:[{id:'verify',title:'写入并读取成果',owner:'开发者'}]})}
      else if(turn===2)tool('workflow-member-write','write',{path:d.file,content:d.fact});
      else if(turn===3)tool('workflow-only-write-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['workflow-member-write']});
      else if(turn===4)tool('workflow-premature-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:'只发生了write，尚未有Workflow要求的read',limitations:[]});
      else if(turn===5){state.prematureDelivery=result(body,'workflow-premature-delivery');assert.equal(state.prematureDelivery.code,'WORKFLOW_EVIDENCE_REQUIRED');assert.equal(state.prematureDelivery.retryable,false);emit({role:'assistant',content:'只有write证据的交付已被拒绝，接着读取实际文件。'});await beforeRead.promise;tool('workflow-member-read','read',{path:d.file})}
      else if(turn===6){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('workflow-valid-step','cbim_task_step',{expectedVersion:3,id:'verify',state:'reported_done',evidenceIds:['workflow-member-read']})}
      else if(turn===7)tool('workflow-valid-delivery','cbim_delivery_prepare',{expectedVersion:4,summary:'实际写入并读取 '+d.fact+'，引用本轮read回执',limitations:['工具调用事实不代替专业语义验收']});
      else if(turn===8){state.delivery=result(body,'workflow-valid-delivery');assert.equal(state.delivery.state,'awaiting_review');reply('真实读取回执已满足声明的Workflow条件，请主调度核实。')}
      else throw Error('Workflow fixture不允许重放成员 '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Workflow condition fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const releaseAll=()=>{beforePlan.release();beforeRead.release()};
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(_agent:string,module:string,selection:OwnerExecutionSelection)=>{moduleId=module;ownerSelection=structuredClone(selection)},releasePlan:()=>beforePlan.release(),releaseRead:()=>beforeRead.release(),releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
