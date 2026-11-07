import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const humanDecisionFixture={
  goal:'HUMAN_DECISION_MAIN: 生成受控文件成果，等待明确人工业务决定',
  memberGoal:'HUMAN_DECISION_MEMBER: 写入成果文件一次，读取验证并采集真实基线',
  file:'human-decision-artifact.txt',fact:'HUMAN_DECISION_REAL_ARTIFACT_5a183',changed:'HUMAN_DECISION_EXTERNAL_CHANGE_f9a2e',
  model:'human-decision-fixture',acceptance:['真实写入并读取成果文件；字节指纹不替代人工业务验收'],
  humanId:'human-review',humanCriterion:'请人工决定该成果是否满足当前展示要求',
  reason:'等待用户对当前真实候选及明确文件范围作出人工决定；保存意见不启动执行。',
  comment:'已逐项查看当前成果和所选文件；此意见仅针对本次明确依据。',
  chatDraft:'保留普通对话草稿，人工决定不能发送它。',
  decisionDraft:'保留未提交的人工意见，重开不得自动发送。',
  final:'成员候选已经登记，本目标等待人工决定；目前未完成业务验收。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolResult(request:Request,id:string):any{
  const result=request.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(result,'Missing actual tool response '+id);
  const text=typeof result.content==='string'?result.content:Array.isArray(result.content)?result.content.map(value=>value&&typeof value==='object'&&'text' in value?String(value.text):'').join(''):'';
  let value=JSON.parse(text);if(Array.isArray(value.content))value=JSON.parse(value.content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join(''));return value;
}

/** Only localhost model output is scripted; native files, tool evidence, candidate and waiting are real. */
export async function humanDecisionProvider(){
  const d=humanDecisionFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];let agentId='',moduleId='';
  const state:{baselineId?:string}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    assert.ok(body.tools?.every(tool=>!tool.function.name.includes('human_decision')),'人工决定不能提供给模型工具');
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'human-decision-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(tool=>!['write','edit','bash','cbim_task_artifact_capture'].includes(tool.function.name)));
      if(turn===0){const plan=goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance});tool('human-goal-plan','cbim_goal_plan',{...plan,criteria:[...plan.criteria,{id:d.humanId,text:d.humanCriterion,kind:'human'}],assignments:plan.assignments.map(item=>({...item,criterionIds:[...item.criterionIds,d.humanId]}))})}
      else if(turn===1)tool('human-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已派发独立执行者，等待真实文件成果。');
      else if(turn===3)tool('human-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4){
        const {scope,graph}=goalInspection(body,'human-goal-inspect'),task=graph.tasks.find(value=>value.scopeId===scope.scopeId);assert.ok(task?.result);assert.equal(task.status,'result_ready');assert.deepEqual(task.result.evidenceRefs,['human-member-read']);
        const evidence={kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:[...task.result.evidenceRefs]};
        tool('human-goal-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:criterion.kind==='human'?'needs_human':'satisfied',reason:criterion.kind==='human'?d.reason:'已核实真实成员成果及读取回执',evidence:[evidence]})),superseded:[],gaps:[d.reason],reason:d.reason});
      }else if(turn===5)reply(d.final);
      else throw Error('保存人工决定不得启动主模型：'+turn);
    }else if(turn===0)tool('human-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'生成真实成果，保留人工业务判断边界',steps:[{id:'verify',title:'生成并核实成果',owner:'开发者'}]});
    else if(turn===1)tool('human-member-write','write',{path:d.file,content:d.fact});
    else if(turn===2)tool('human-member-read','read',{path:d.file});
    else if(turn===3){assert.ok(JSON.stringify(body.messages).includes(d.fact));tool('human-artifact-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:2,sourceToolCallIds:['human-member-write','human-member-read']})}
    else if(turn===4){const result=toolResult(body,'human-artifact-capture');assert.equal(result.state,'captured');assert.equal(typeof result.baseline?.baselineId,'string');state.baselineId=result.baseline.baselineId;tool('human-member-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['human-member-read']})}
    else if(turn===5)tool('human-member-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:'已生成并读取真实成果 '+d.fact,limitations:['当前只覆盖明确成果文件，业务符合性仍须人工判断']});
    else if(turn===6)reply('真实候选及明确文件基线已提交，等待主调度与人工审阅。');
    else throw Error('保存人工决定不得重跑成员：'+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Human decision fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
