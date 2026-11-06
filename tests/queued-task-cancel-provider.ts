import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const queuedTaskCancelFixture={
  mainGoal:'QUEUED_CANCEL_MAIN: 按A→B→C顺序核实材料，缺输入时明确撤销未启动依赖后等待；补充后以新任务完成',
  oldGoals:['QUEUED_CANCEL_A: 读取起始材料并报告输入缺口','QUEUED_CANCEL_B: 等待A后核实第二份材料','QUEUED_CANCEL_C: 等待B后核实第三份材料'],
  newGoals:['QUEUED_CANCEL_A2: 根据补充重新核实第一份材料','QUEUED_CANCEL_B2: 等待A2结果后核实第二份材料','QUEUED_CANCEL_C2: 等待B2结果后核实第三份材料'],
  files:['cancel-a.txt','cancel-b.txt','cancel-c.txt'],facts:['CANCEL_FACT_A_5d82','CANCEL_FACT_B_e791','CANCEL_FACT_C_70a1'],
  acceptance:['按依赖顺序取得三份材料的真实读取证据，保留旧节点与替代关系'],
  helpReason:'起始材料缺少处理说明，不能完成A，也不能让依赖任务B/C启动。',
  helpQuestion:'请主调度取消未启动的依赖待办并等待用户补充处理说明。',
  cancelReason:'A已经求助且无法提供前置结果；明确撤销尚未启动的B和C，保留历史后等待用户补充。',
  waitReason:'未启动依赖已明确撤销，需要用户补充三份材料的处理说明，当前目标尚未完成。',
  supplement:'请按A、B、C顺序分别读取三份现有材料并提交证据；每项新建独立任务，不重启旧节点。',
  continuationLive:'补充已受理，准备重新规划A2、B2、C2；旧撤销节点保持不变。',
  final:'新的A2、B2、C2已按依赖顺序核实；旧求助和撤销节点保留，替代关系已明确登记。',
  draft:'保留普通草稿，不作为撤销任务的权限或目标补充。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolValue(body:Request,id:string){const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message);assert.equal(typeof message.content,'string');return JSON.parse(message.content as string)}
function toolText(body:Request,id:string){const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message);return JSON.stringify(message.content)}

/** Local deterministic responses; dispatch, canonical logs, read tools and goal gates are real. */
export async function queuedTaskCancelProvider(options:{holdContinuation?:boolean;invalidComplete?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];let agentId='',moduleId='',releaseContinuation=()=>{};
  const continuationGate=new Promise<void>(resolve=>{releaseContinuation=resolve}),d=queuedTaskCancelFixture;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'queued-cancel-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const dispatch=(id:string,goal:string,prior?:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:prior?[{taskId:prior,expectedPlanRevision:1}]:[]});
    if(isMain){
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_dispatch_cancel'),'主调度必须有明确撤销入口');
      if(turn===0)tool('cancel-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.mainGoal,agentId,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(turn===1)dispatch('cancel-old-a',d.oldGoals[0]);
      else if(turn===2)dispatch('cancel-old-b',d.oldGoals[1],toolValue(body,'cancel-old-a').taskId);
      else if(turn===3)dispatch('cancel-old-c',d.oldGoals[2],toolValue(body,'cancel-old-b').taskId);
      else if(turn===4)reply('原A/B/C已按依赖派发，等待A执行。');
      else if(turn===5){assert.ok(JSON.stringify(body.messages).includes(d.helpReason));tool('cancel-before','cbim_goal_inspect',{})}
      else if(turn===6){const {graph}=goalInspection(body,'cancel-before'),b=graph.tasks.find(task=>task.goal===d.oldGoals[1])!;assert.equal(b.runIds.length,0);tool('cancel-wrong-set','cbim_dispatch_cancel',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},targets:[{taskId:b.taskId,expectedRevision:b.revision}],reason:d.cancelReason})}
      else if(turn===7){const failure=toolText(body,'cancel-wrong-set'),c=goalInspection(body,'cancel-before').graph.tasks.find(task=>task.goal===d.oldGoals[2])!;assert.ok(failure.includes('CANCEL_DEPENDENTS_REQUIRED')&&failure.includes(c.taskId),'遗漏后继必须明确拒绝并指明缺少的任务');tool('cancel-after-wrong','cbim_goal_inspect',{})}
      else if(turn===8){
        const before=goalInspection(body,'cancel-before'),after=goalInspection(body,'cancel-after-wrong');assert.deepEqual(after.graph,before.graph,'错误集合不能部分撤销或变更图游标');
        const targets=after.graph.tasks.filter(task=>d.oldGoals.slice(1).includes(task.goal));assert.equal(targets.length,2);assert.ok(targets.every(task=>task.runIds.length===0));
        tool('cancel-exact','cbim_dispatch_cancel',{expectedGraphCursor:{streamId:after.graph.cursor.streamId,seq:after.graph.cursor.seq},targets:targets.map(task=>({taskId:task.taskId,expectedRevision:task.revision})),reason:d.cancelReason});
      }else if(turn===9)tool('cancel-after','cbim_goal_inspect',{});
      else if(turn===10){const {scope,graph}=goalInspection(body,'cancel-after');assert.ok(graph.tasks.filter(task=>d.oldGoals.slice(1).includes(task.goal)).every(task=>task.status==='cancelled'&&task.runIds.length===0&&!task.result));tool('cancel-not-success','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'satisfied',reason:'故意尝试把撤销当作完成，应该被拒绝',evidence:[]})),superseded:[],gaps:[],reason:'测试无真实候选时撤销不能完成目标'})}
      else if(turn===11){assert.ok(toolText(body,'cancel-not-success').includes('GOAL_'),'撤销不构成目标完成证据');tool('cancel-wait-inspect','cbim_goal_inspect',{})}
      else if(turn===12){if(options.invalidComplete)reply('仅文字声称目标完成，没有合法完成审阅。');else{const {scope}=goalInspection(body,'cancel-wait-inspect');tool('cancel-wait-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'awaiting_user',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:d.waitReason,evidence:[]})),superseded:[],gaps:[d.waitReason],reason:d.waitReason})}}
      else if(turn===13&&!options.invalidComplete)reply(d.waitReason);
      else if(turn===14){assert.ok(JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content).includes(d.supplement));if(options.holdContinuation){emit({role:'assistant',content:d.continuationLive});await continuationGate}tool('cancel-resume-inspect','cbim_goal_inspect',{})}
      else if(turn===15){const {scope}=goalInspection(body,'cancel-resume-inspect');tool('cancel-replan','cbim_goal_plan',{...goalPlanArguments({objective:d.mainGoal,agentId,moduleIds:[moduleId],acceptance:d.acceptance},scope.goal.revision),reason:'按用户补充新建三项任务与依赖，旧求助/撤销历史不可复活'})}
      else if(turn===16)dispatch('cancel-new-a',d.newGoals[0]);
      else if(turn===17)dispatch('cancel-new-b',d.newGoals[1],toolValue(body,'cancel-new-a').taskId);
      else if(turn===18)dispatch('cancel-new-c',d.newGoals[2],toolValue(body,'cancel-new-b').taskId);
      else if(turn===19)reply('新任务A2/B2/C2已独立派发，旧撤销节点保持原样。');
      else if(turn===20)tool('cancel-final-inspect','cbim_goal_inspect',{});
      else if(turn===21){
        const {scope,graph}=goalInspection(body,'cancel-final-inspect'),old=d.oldGoals.map(goal=>graph.tasks.find(task=>task.goal===goal)!),fresh=d.newGoals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);assert.equal(graph.tasks.length,6);assert.ok(fresh.every(task=>task.status==='result_ready'&&task.result));assert.equal(new Set([...old,...fresh].map(task=>task.assignee.agentInstanceId)).size,6);
        const evidence=fresh.map(task=>({kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.result!.planRevision,toolCallIds:task.result!.evidenceRefs}));
        tool('cancel-complete','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'complete',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'satisfied',reason:'核实三个新任务的真实读取回执和依赖结果',evidence})),superseded:old.map((task,index)=>({taskId:task.taskId,replacementTaskIds:[fresh[index].taskId],reason:'新任务已按显式补充提交真实候选，保留原节点不重放'})),gaps:[],reason:'当前计划已由三个新实例完成，旧求助和撤销不作为成功证据'});
      }else if(turn===22)reply(d.final);
      else throw Error('队列撤销不应自动重放或追加模型请求：'+turn);
    }else{
      assert.ok(body.tools?.every(item=>!['cbim_dispatch_cancel','cbim_dispatch_task'].includes(item.function.name)),'执行者没有派工或撤销权限');
      if(turn===0)tool('cancel-a-plan','cbim_task_plan',{expectedVersion:0,goal:d.oldGoals[0],reason:'先核实起始材料与输入缺口',acceptance:d.acceptance,steps:[{id:'read',title:'读取起始材料',owner:'开发者'}]});
      else if(turn===1)tool('cancel-a-read','read',{path:d.files[0]});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[0]));tool('cancel-a-help','cbim_task_help',{kind:'missing_input',reason:d.helpReason,question:d.helpQuestion,attemptedToolCallIds:['cancel-a-read']})}
      else if(turn===3)reply('本轮结束，未提交候选，请主调度处理未启动依赖。');
      else{
        const index=Math.floor((turn-4)/5),step=(turn-4)%5;assert.ok(index>=0&&index<3);const prefix='cancel-replacement-'+index;
        if(step===0){assert.ok(JSON.stringify(body.messages).includes(d.newGoals[index]),'不能执行已撤销的旧B/C');tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:d.newGoals[index],reason:'按用户补充核实新的独立任务',acceptance:d.acceptance,steps:[{id:'read',title:'读取本任务材料',owner:'开发者'}]})}
        else if(step===1)tool(prefix+'-read','read',{path:d.files[index]});
        else if(step===2){assert.ok(JSON.stringify(body.messages).includes(d.facts[index]));tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[prefix+'-read']})}
        else if(step===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'已独立读取材料：'+d.facts[index],limitations:['不重启旧撤销任务，不代表人工业务验收']});
        else reply('当前新任务读取证据已提交。');
      }
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Queued task cancellation fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,releaseContinuation,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{releaseContinuation();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
