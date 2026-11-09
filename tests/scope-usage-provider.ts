import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const scopeUsageFixture={
  goal:'SCOPE_USAGE_FIRST: 请独立核实业务文件，按读取证据完成本目标',
  nextGoal:'SCOPE_USAGE_SECOND: 第二个独立目标，只回复一条普通对话，不派发成员任务。',
  memberGoal:'SCOPE_USAGE_MEMBER: 读取 scope-usage-source.txt，提交真实读取回执。',
  file:'scope-usage-source.txt',fact:'SCOPE_USAGE_REAL_FILE_49c2e',model:'scope-usage-fixture',
  acceptance:['实际读取 scope-usage-source.txt 并提交可追溯证据'],
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only provider output/usage are deterministic; execution, native reads, journals and aggregation remain real. */
export async function scopeUsageProvider(){
  const d=scopeUsageFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];
  let ownerSelection:OwnerExecutionSelection|undefined;let agentId='',moduleId='',release=()=>{};const memberGate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'scope-usage-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:isMain?100:200,completion_tokens:isMain?20:40,total_tokens:isMain?120:240}}:{})})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('usage-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,ownerSelection,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(turn===1)tool('usage-dispatch','cbim_dispatch_task',{agentId,ownerSelection,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已登记本目标的独立成员任务，等待真实证据。');
      else if(turn===3)tool('usage-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4)tool('usage-goal-review','cbim_goal_review',goalCompleteArguments(body,'usage-goal-inspect'));
      else if(turn===5)reply('第一目标已经按真实文件证据完成。');
      else if(turn===6){assert.ok(JSON.stringify(body.messages.at(-1)).includes(d.nextGoal));reply('第二目标的普通对话已完成，未派发成员。')}
      else throw Error('Unexpected main replay or duplicate aggregation request: '+turn);
    }else{
      assert.ok(body.tools?.every(item=>item.function.name!=='cbim_dispatch_task'));
      if(turn===0){emit({role:'assistant',content:'成员已开始，等待本机计量检查。'});await memberGate;tool('usage-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'读取真实业务文件',acceptance:d.acceptance,steps:[{id:'verify',title:'读取文件并提交证据',owner:'开发者'}]})}
      else if(turn===1)tool('usage-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('usage-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['usage-read']})}
      else if(turn===3)tool('usage-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取证据：'+d.fact,limitations:['只核实读取事实，不代替人工业务验收']});
      else if(turn===4)reply('成员已提交真实读取候选。');
      else throw Error('Unexpected member replay: '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Scope usage fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,bind:(agent:string,module:string,selection?:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection?structuredClone(selection):undefined},releaseMember:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
