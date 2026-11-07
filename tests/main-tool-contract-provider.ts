import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export type MainToolContractMode='complete'|'stop'|'bad-plan'|'bad-dispatch';
export const mainToolContractFixture={goal:'MAIN_TOOL_CONTRACT: 独立成员读取真实文件，按真实候选审阅当前目标',memberGoal:'MAIN_TOOL_CONTRACT_MEMBER: 读取 main-tool-contract.txt 并提交真实读取回执',model:'main-tool-contract-fixture',file:'main-tool-contract.txt',fact:'MAIN_TOOL_CONTRACT_REAL_FILE_3a572',acceptance:['实际读取 main-tool-contract.txt 并提交读取回执'],draft:'原对话草稿保持，不随调度工具读取或停止自动发送。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

export function mainToolValue(request:Request,callId:string):any{
  const message=request.messages.find(item=>item.role==='tool'&&item.tool_call_id===callId);assert.ok(message,'Missing actual tool response '+callId);const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(item=>item&&typeof item==='object'&&'text'in item?String(item.text):'').join(''):'';
  const parse=(value:string)=>{try{return JSON.parse(value)}catch{return {error:value}}};let result=parse(text);if(Array.isArray(result.content))result=parse(result.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));return result;
}

/** A deterministic local response stream; all plan/dispatch/inspect/read/review operations are actual product calls. */
export async function mainToolContractProvider(mode:MainToolContractMode='complete'){
  const main:Request[]=[],member:Request[]=[],errors:string[]=[],state:{plan?:any;receipt?:any;graph?:any;task?:any;fault?:any;faultConfirmed?:boolean}={};let agentId='',moduleId='',release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as Request,isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true,list=isMain?main:member,turn=list.length;list.push(body);assert.equal(body.model,mainToolContractFixture.model);const d=mainToolContractFixture;
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'main-contract-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n'),tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));assert.ok(['cbim_goal_inspect','cbim_goal_plan','cbim_goal_review','cbim_dispatch_task','cbim_dispatch_inspect','cbim_dispatch_cancel','cbim_dispatch_replace_dependency','cbim_dispatch_resume'].every(name=>body.tools?.some(item=>item.function.name===name)));
      if(turn===0)tool('contract-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(mode==='bad-plan'){
        if(turn===1){state.fault=mainToolValue(body,'contract-goal-plan');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);tool('contract-fault-inspect','cbim_goal_inspect',{})}
        else if(turn===2){const observed=goalInspection(body,'contract-fault-inspect');assert.equal(observed.scope.goal.revision,2);assert.equal(observed.graph.tasks.length,0);state.faultConfirmed=true;emit({role:'assistant',content:'规划可能已保存，已只读核实原计划；未再次调用规划或派工，等待人工停止本次验证。'});await gate;reply('原计划保留，未重试。')}
        else throw Error('Malformed plan must not be retried: '+turn);
      }else if(turn===1){state.plan=mainToolValue(body,'contract-goal-plan');assert.equal(state.plan.goal.revision,2);tool('contract-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]})}
      else if(mode==='bad-dispatch'){
        if(turn===2){state.fault=mainToolValue(body,'contract-dispatch');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);tool('contract-fault-graph','cbim_dispatch_inspect',{})}
        else if(turn===3){state.graph=mainToolValue(body,'contract-fault-graph');assert.equal(state.graph.tasks.length,1);assert.deepEqual(state.graph.tasks[0].runIds,[]);tool('contract-fault-inspect','cbim_goal_inspect',{})}
        else if(turn===4){const observed=goalInspection(body,'contract-fault-inspect');assert.equal(observed.scope.goal.revision,2);assert.equal(observed.graph.tasks.length,1);assert.equal(observed.graph.tasks[0].taskId,state.graph.tasks[0].taskId);state.faultConfirmed=true;emit({role:'assistant',content:'派发可能已提交，已只读核实唯一原任务；未重复派发，等待人工停止本次验证。'});await gate;reply('原任务记录保留，未重试。')}
        else throw Error('Malformed dispatch must not be replayed: '+turn);
      }else if(turn===2){state.receipt=mainToolValue(body,'contract-dispatch');assert.equal(state.receipt.disposition,'queued');assert.equal(typeof state.receipt.taskId,'string');tool('contract-dispatch-graph','cbim_dispatch_inspect',{})}
      else if(turn===3){state.graph=mainToolValue(body,'contract-dispatch-graph');assert.equal(state.graph.tasks.length,1);assert.equal(state.graph.tasks[0].taskId,state.receipt.taskId);tool('contract-dispatch-node','cbim_dispatch_inspect',{taskId:state.receipt.taskId})}
      else if(turn===4){state.task=mainToolValue(body,'contract-dispatch-node');assert.equal(state.task.taskId,state.receipt.taskId);assert.deepEqual(state.task.runIds,[]);reply('已登记唯一成员任务，尚未执行或验收。')}
      else if(turn===5)tool('contract-goal-inspect','cbim_goal_inspect',{});
      else if(turn===6)tool('contract-goal-review','cbim_goal_review',goalCompleteArguments(body,'contract-goal-inspect'));
      else if(turn===7){const reviewed=mainToolValue(body,'contract-goal-review');assert.equal(reviewed.goal.review.decision,'complete');assert.equal(reviewed.status,'active');reply('已核对成员真实读取候选并申请完成复核；没有把派发回执当作业务证据。')}
      else throw Error('Unexpected main replay '+turn);
    }else{
      assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')&&!item.function.name.startsWith('cbim_goal_')));
      if(turn===0){emit({role:'assistant',content:'成员已独立启动，等待本机验证闸门。'});await gate;tool('contract-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'核实实际文件，使用独立执行者上下文',acceptance:d.acceptance,steps:[{id:'verify',title:'读取真实文件',owner:'开发者'}]})}
      else if(turn===1)tool('contract-member-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('contract-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['contract-member-read']})}
      else if(turn===3)tool('contract-member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际读取 '+d.fact,limitations:['读取回执不代表人工业务验收']});
      else if(turn===4)reply('已提交真实读取候选。');
      else throw Error('Unexpected member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Main tool contract fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,state,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},release:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
