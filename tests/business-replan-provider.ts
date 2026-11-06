import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const businessReplanFixture={
  oldGoal:'REPLAN_OLD: 执行一次隔离业务操作，保留失败事实',
  oldMemberGoal:'REPLAN_OLD_MEMBER: 仅执行一次隔离写入并报告错误',
  oldSecret:'REPLAN_OLD_PRIVATE_CONTEXT_20e3',
  marker:'replan-old-marker.txt',markerLine:'OLD_BUSINESS_WRITE_ONCE_65ea\n',
  observation:'旧业务标记已出现；本次仅提交观察，不表示旧任务完成。',
  inspectionGoal:'REPLAN_INSPECT: 只读取 replan-old-marker.txt 核实既有影响，禁止再次执行旧命令',
  inspectionMemberGoal:'REPLAN_INSPECT_MEMBER: 只读取得旧标记内容作为核实证据',
  inspectionSecret:'INSPECTION_PRIVATE_CONTEXT_63f7',
  businessGoal:'REPLAN_NEW: 独立创建 replan-new-result.txt 并读取验证，禁止重放旧操作或改写旧标记',
  businessMemberGoal:'REPLAN_NEW_MEMBER: 创建新结果文件并实际读取验证',
  result:'replan-new-result.txt',resultText:'NEW_BUSINESS_RESULT_VERIFIED_3ab6\n',
  businessLive:'新的正式业务周期已经受理，正准备独立派工。',
  final:'新业务文件已独立创建并读取验证；旧失败任务、核实记录和标记均保留，不代表人工业务验收。',
  queued:'保留普通排队消息，不作为业务重规划授权',draft:'普通对话草稿保持不变，不作为新业务目标',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolValue(body:Request,id:string){const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message);assert.equal(typeof message.content,'string');return JSON.parse(message.content as string)}

/** Local model responses drive three real Pi cycles: failed write, read-only inspection, new work. */
export async function businessReplanProvider(options:{holdBusiness?:boolean;holdOld?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];let agentId='',moduleId='',releaseBusiness=()=>{},releaseOld=()=>{};
  const businessGate=new Promise<void>(resolve=>{releaseBusiness=resolve}),oldGate=new Promise<void>(resolve=>{releaseOld=resolve}),d=businessReplanFixture;
  const acceptance=['提交当前目标实际工具回执和读取验证'];
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'replan-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const dispatch=(id:string,goal:string)=>tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
    const plan=(id:string,goal:string)=>tool(id,'cbim_goal_plan',goalPlanArguments({objective:goal,agentId,moduleIds:[moduleId],acceptance}));
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)),'主Agent始终只调度，不直接执行业务');
      if(turn===0)plan('old-plan',d.oldGoal);
      else if(turn===1)dispatch('old-dispatch',d.oldMemberGoal);
      else if(turn===2)reply('旧业务已派发。'+d.oldSecret);
      else if(turn===3)tool('old-inspect','cbim_goal_inspect',{});
      else if(turn===4){const {scope}=goalInspection(body,'old-inspect');tool('old-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'命令失败且已经写入旧标记',evidence:[]})),superseded:[],gaps:['旧业务失败，副作用不能当作未发生'],reason:'保留失败事实，不自动重放'})}
      else if(turn===5)reply('旧业务失败，保留副作用，等待显式核实。');
      else if(turn===6){assert.ok(!JSON.stringify(body.messages).includes(d.oldSecret));plan('inspection-plan',d.inspectionGoal)}
      else if(turn===7)dispatch('inspection-dispatch',d.inspectionMemberGoal);
      else if(turn===8)reply('独立核实已派发。'+d.inspectionSecret);
      else if(turn===9)tool('inspection-inspect','cbim_goal_inspect',{});
      else if(turn===10)tool('inspection-review','cbim_goal_review',goalCompleteArguments(body,'inspection-inspect'));
      else if(turn===11)reply('核实完成，仅确认旧标记已经存在，不批准新业务执行。');
      else if(turn===12){
        assert.ok(!JSON.stringify(body.messages).includes(d.oldSecret));assert.ok(!JSON.stringify(body.messages).includes(d.inspectionSecret),'新业务应全新主上下文，不续接核实原生消息');assert.ok(JSON.stringify(body.messages).includes(d.businessGoal));
        if(options.holdBusiness){emit({role:'assistant',content:d.businessLive});await businessGate}plan('business-plan',d.businessGoal);
      }else if(turn===13)dispatch('business-dispatch',d.businessMemberGoal);
      else if(turn===14)reply('新业务已独立派发，旧任务保持封存。');
      else if(turn===15)tool('business-inspect','cbim_goal_inspect',{});
      else if(turn===16)tool('business-review','cbim_goal_review',goalCompleteArguments(body,'business-inspect'));
      else if(turn===17)reply(d.final);
      else throw Error('新业务重规划不得在重启或查询时再次请求模型：'+turn);
    }else{
      if(turn>=3&&turn<=7)assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)),'核实执行实例必须保持只读');
      if(turn>=8)assert.ok(body.tools?.some(item=>item.function.name==='write'),'明确新业务权限下应提供实际写入工具');
      if(turn===0)tool('old-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.oldMemberGoal,reason:'仅执行一次隔离操作',acceptance,steps:[{id:'work',title:'执行旧业务操作',owner:'开发者'}]});
      else if(turn===1)tool('old-write','bash',{command:`node -e "require('node:fs').appendFileSync('${d.marker}','OLD_BUSINESS_WRITE_ONCE_65ea\\n');process.exit(17)"`});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes('17'));if(options.holdOld)await oldGate;emit({role:'assistant',content:'实际命令失败，不能假定没有修改。'});emit({},'length')}
      else if(turn===3)tool('inspection-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.inspectionMemberGoal,reason:'只读核实已有影响',acceptance,steps:[{id:'read',title:'读取旧标记',owner:'开发者'}]});
      else if(turn===4)tool('inspection-read','read',{path:d.marker});
      else if(turn===5){assert.ok(JSON.stringify(body.messages).includes(d.markerLine.trim()));tool('inspection-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:['inspection-read']})}
      else if(turn===6)tool('inspection-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'只读确认旧标记为 '+d.markerLine.trim(),limitations:['不代表旧业务目标完成，也不授权新的业务写入']});
      else if(turn===7)reply('只读核实证据已提交。');
      else if(turn===8)tool('business-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.businessMemberGoal,reason:'按用户新目标独立创建与验证结果，旧文件不动',acceptance,steps:[{id:'create',title:'创建新结果并读取验证',owner:'开发者'}]});
      else if(turn===9)tool('business-write','write',{path:d.result,content:d.resultText});
      else if(turn===10)tool('business-read','read',{path:d.result});
      else if(turn===11){assert.ok(JSON.stringify(body.messages).includes(d.resultText.trim()));tool('business-task-inspect','cbim_task_inspect',{})}
      else if(turn===12){const progress=toolValue(body,'business-task-inspect');assert.ok(progress.evidence.some((item:{toolCallId:string})=>item.toolCallId==='business-read'));tool('business-step','cbim_task_step',{expectedVersion:progress.plan.version,id:'create',state:'reported_done',evidenceIds:['business-write','business-read']})}
      else if(turn===13)tool('business-delivery','cbim_delivery_prepare',{expectedVersion:toolValue(body,'business-step').version,summary:'新文件创建成功并实际读取确认：'+d.resultText.trim(),limitations:['未修改或重放旧业务标记，不代替人工业务验收']});
      else if(turn===14)reply('新业务候选已提交。');
      else throw Error('未知执行成员请求：'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Business replan fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,releaseBusiness,releaseOld,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{releaseBusiness();releaseOld();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
