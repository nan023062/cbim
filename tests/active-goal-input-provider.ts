import {serveFixtureCompaction} from './dependency-review-provider-fixture';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';

export const activeInputData={
  model:'active-goal-input-fixture',goal:'ACTIVE_INPUT_MAIN: 核实业务文件并按照最新用户要求汇报',
  memberGoal:'ACTIVE_INPUT_MEMBER: 读取 active-input.txt 并提交可追溯证据',
  file:'active-input.txt',fact:'ACTIVE_INPUT_REAL_FILE_74d109',acceptance:['真实读取 active-input.txt 并提交读取回执'],
  insert:'ACTIVE_INPUT_ONE: 新要求：将核实事实写成两条短句，不能沿用先前的完成结论。',
  second:'ACTIVE_INPUT_TWO: 再补充：每条短句加上编号，仍须重新核对当前目标。',
  continuation:'ACTIVE_INPUT_CONTINUATION: 展示格式确定为简短编号列表，请核对完整补充历史后继续。',
  waitReason:'实际文件证据已核实，请补充最终展示格式；这不是人工验收。',
  draft:'普通草稿：运行中补充不应清除这段内容',
};
export type ActiveInputMode='stale-complete'|'stale-waiting'|'replan'|'twice'|'waiting'|'twice-waiting';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only local model responses are deterministic; every plan, read, candidate, review and steer stays real. */
export async function activeInputProvider(mode:ActiveInputMode='replan'){
  const d=activeInputData,main:Request[]=[],member:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection;const gates=new Map<number,{promise:Promise<void>;release:()=>void}>();
  const gate=(turn:number)=>{let item=gates.get(turn);if(!item){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);item={promise,release};gates.set(turn,item)}return item};
  const twice=mode==='twice'||mode==='twice-waiting';gate(5);if(twice)gate(11);
  const compactions:GoalFixtureRequest[]=[];
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
    const requests=isMain?main:member,turn=requests.length;if(serveFixtureCompaction(body,res,compactions))return;requests.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'active-input-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const plan=(revision=1)=>goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance},revision);
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('active-plan','cbim_goal_plan',plan());
      else if(turn===1)tool('active-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已派发真实文件核实任务，等待成员结果。');
      else if(turn===3)tool('active-before-input','cbim_goal_inspect',{});
      else if(turn===4){const review=goalCompleteArguments(body,'active-before-input');tool('active-old-review','cbim_goal_review',mode==='stale-waiting'?{...review,decision:'awaiting_user',gaps:[d.waitReason],reason:d.waitReason}:review)}
      else if(turn===5){emit({role:'assistant',content:'旧审阅已保存，测试窗口保持本轮进行。'});await gate(5).promise;reply('旧审阅对应的回复结束。')}
      else if(turn===6){assert.ok(JSON.stringify(body.messages).includes(d.insert));if(mode.startsWith('stale-'))reply('收到了新增要求，但本地供应商故意不重新规划或审阅。');else tool('active-after-input','cbim_goal_inspect',{})}
      else if(mode.startsWith('stale-')&&turn>=7){
        // 保持旧版本的故意错误行为，验证有界反馈不能自行恢复过期审阅或再次执行成员。
        assert.ok(turn<=8);assert.ok(JSON.stringify(body.messages.at(-1)?.content).includes('CBIM 最终验收未通过'));
        reply('仍未按新增要求重新规划或审阅，不能沿用旧完成或等待结论。');
      }
      else if(turn===7)tool('active-stale-review','cbim_goal_review',goalCompleteArguments(body,'active-after-input'));
      else if(turn===8){const result=body.messages.find(item=>item.tool_call_id==='active-stale-review');assert.ok(JSON.stringify(result).includes('GOAL_REPLAN_REQUIRED'));const {scope}=goalInspection(body,'active-after-input');tool('active-replan','cbim_goal_plan',{...plan(scope.goal.revision),constraints:['只汇报真实文件事实','按新输入改成两条短句'],reason:'根据已接收的新输入重新规划，不沿用旧审阅'})}
      else if(turn===9)tool('active-after-replan','cbim_goal_inspect',{});
      else if(turn===10){const review=goalCompleteArguments(body,'active-after-replan');tool('active-current-review','cbim_goal_review',mode==='waiting'?{...review,decision:'awaiting_user',gaps:[d.waitReason],reason:d.waitReason}:review)}
      else if(turn===11){if(twice){emit({role:'assistant',content:'第一条补充已重新审阅，等待第二条测试补充。'});await gate(11).promise}reply(mode==='waiting'?'新输入已重新核对，等待进一步格式说明。':'已按照新输入重新核实真实证据。')}
      else if(turn===12){assert.ok(twice||mode==='waiting');assert.ok(JSON.stringify(body.messages).includes(twice?d.second:d.continuation));tool('active-second-inspect','cbim_goal_inspect',{})}
      else if(turn===13){const {scope}=goalInspection(body,'active-second-inspect');tool('active-second-plan','cbim_goal_plan',{...plan(scope.goal.revision),constraints:['只汇报真实文件事实','两条短句加编号'],reason:'同一主运行内第二条补充也需要重新规划'})}
      else if(turn===14)tool('active-second-ready','cbim_goal_inspect',{});
      else if(turn===15){const review=goalCompleteArguments(body,'active-second-ready');tool('active-second-review','cbim_goal_review',mode==='twice-waiting'?{...review,decision:'awaiting_user',gaps:[d.waitReason],reason:d.waitReason}:review)}
      else if(turn===16)reply(mode==='twice-waiting'?'两条补充已重新审阅，等待明确最终展示格式。':'补充已经重新规划和审阅。');
      else if(turn===17){assert.equal(mode,'twice-waiting');assert.ok(JSON.stringify(body.messages).includes(d.continuation));tool('active-continuation-inspect','cbim_goal_inspect',{})}
      else if(turn===18){const {scope}=goalInspection(body,'active-continuation-inspect');tool('active-continuation-plan','cbim_goal_plan',{...plan(scope.goal.revision),constraints:['只汇报真实文件事实','完整采用两次运行中补充及等待后的编号列表格式'],reason:'依据完整连续输入版本重规划'})}
      else if(turn===19)tool('active-continuation-ready','cbim_goal_inspect',{});
      else if(turn===20)tool('active-continuation-review','cbim_goal_review',goalCompleteArguments(body,'active-continuation-ready'));
      else if(turn===21)reply('运行中两条补充与等待后的格式补充均已重新核实，目标完成。');
      else throw Error('Unexpected active input replay: '+turn);
    }else{
      if(turn===0)tool('active-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'核实真实文件',acceptance:d.acceptance,steps:[{id:'verify',title:'读取文件并提交证据',owner:'开发者'}]});
      else if(turn===1)tool('active-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('active-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['active-read']})}
      else if(turn===3)tool('active-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取：'+d.fact,limitations:['这里只验证读取事实，不代替人工业务验收']});
      else if(turn===4)reply('真实读取候选已提交。');
      else throw Error('New format must not replay member: '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Active input fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {compactions,url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=selection},release:(turn=5)=>gate(turn).release(),close:async()=>{for(const item of gates.values())item.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
