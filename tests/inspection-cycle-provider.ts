import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const inspectionFixture={
  oldGoal:'INSPECTION_OLD: 执行一次隔离操作并如实保留失败事实',
  oldMemberGoal:'INSPECTION_OLD_MEMBER: 写入一次隔离标记后报告命令状态',
  marker:'inspection-cycle-marker.txt',
  markerLine:'INSPECTION_OLD_WRITE_ONCE_51d2\n',
  oldSecret:'OLD_NATIVE_PRIVATE_SENTINEL_57fc4a',
  oldFailure:'业务命令失败，文件可能已经改变；不要自动重放。',
  observation:'我确认标记文件存在，但尚未核实内容；旧运行结果仍以原报告为准。',
  newGoal:'INSPECTION_NEW: 只读取 inspection-cycle-marker.txt，核实已有修改并汇报；不得改写或重放旧操作',
  newMemberGoal:'INSPECTION_READ_MEMBER: 只读核实已有标记内容并提交读取证据',
  oldAcceptance:['提供真实工具执行回执'],
  newAcceptance:['实际只读读取已有标记并汇报，不产生新的业务修改'],
  live:'新只读核实周期已建立，正在检查已有执行影响。',
  final:'已只读核实已有标记，未重复旧写入；不代替人工业务验收。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** The initial real command appends once then fails; the fresh cycle can only read that side effect. */
export async function inspectionCycleProvider(options:{holdFresh?:boolean;holdOld?:boolean;again?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',releaseFresh=()=>{},releaseOld=()=>{};
  const gate=new Promise<void>(resolve=>{releaseFresh=resolve});
  const oldGate=new Promise<void>(resolve=>{releaseOld=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'inspection-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        // The first fresh stream is explicitly cancelled before dispatch. A second user command
        // starts at plan again, never at the cancelled stream's next tool or previous native head.
        const step=options.again&&turn>=7?turn-1:turn;
        if(step===0)tool('inspection-old-plan','cbim_goal_plan',goalPlanArguments({objective:inspectionFixture.oldGoal,agentId,moduleIds:[moduleId],acceptance:inspectionFixture.oldAcceptance}));
        else if(step===1)tool('inspection-old-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:inspectionFixture.oldMemberGoal,acceptance:inspectionFixture.oldAcceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(step===2)reply('已派发。'+inspectionFixture.oldSecret);
        else if(step===3)tool('inspection-old-inspect','cbim_goal_inspect',{});
        else if(step===4){const {scope}=goalInspection(body,'inspection-old-inspect');tool('inspection-old-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:inspectionFixture.oldFailure,evidence:[]})),superseded:[],gaps:[inspectionFixture.oldFailure],reason:inspectionFixture.oldFailure})}
        else if(step===5)reply(inspectionFixture.oldFailure);
        else if(step===6){
          assert.ok(!JSON.stringify(body.messages).includes(inspectionFixture.oldSecret),'新原生上下文不得加载旧主会话正文');
          if(options.again&&turn===7)assert.ok(!JSON.stringify(body.messages).includes(inspectionFixture.live),'再次核实不得续接已停止的原生上下文');
          assert.ok(JSON.stringify(body.messages).includes(inspectionFixture.newGoal),'新核实目标必须作为显式用户输入');
          assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)),'新主周期保持只读工具边界');
          if(options.holdFresh&&turn===6){emit({role:'assistant',content:inspectionFixture.live});await gate}
          tool('inspection-new-plan','cbim_goal_plan',goalPlanArguments({objective:inspectionFixture.newGoal,agentId,moduleIds:[moduleId],acceptance:inspectionFixture.newAcceptance}));
        }else if(step===7)tool('inspection-new-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:inspectionFixture.newMemberGoal,acceptance:inspectionFixture.newAcceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(step===8)reply('已派发新的只读执行者，旧操作不重放。');
        else if(step===9)tool('inspection-new-inspect','cbim_goal_inspect',{});
        else if(step===10)tool('inspection-new-review','cbim_goal_review',goalCompleteArguments(body,'inspection-new-inspect'));
        else if(step===11)reply(inspectionFixture.final);
        else throw Error('查询回执或重启不能增加模型请求：'+turn);
      }else{
        if(turn>=3)assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)),'新执行者必须只有只读原生工具');
        if(turn===0)tool('inspection-old-task-plan','cbim_task_plan',{expectedVersion:0,goal:inspectionFixture.oldMemberGoal,reason:'只执行一次已授权隔离操作',acceptance:inspectionFixture.oldAcceptance,steps:[{id:'execute',title:'执行一次隔离操作',owner:'开发者'}]});
        else if(turn===1)tool('inspection-old-write','bash',{command:`node -e "require('node:fs').appendFileSync('${inspectionFixture.marker}','INSPECTION_OLD_WRITE_ONCE_51d2\\n');process.exit(17)"`});
        else if(turn===2){assert.ok(JSON.stringify(body.messages).includes('17'));if(options.holdOld)await oldGate;emit({role:'assistant',content:inspectionFixture.oldFailure});emit({},'length')}
        else if(turn===3)tool('inspection-new-task-plan','cbim_task_plan',{expectedVersion:0,goal:inspectionFixture.newMemberGoal,reason:'新周期只核实已有事实，不重放旧写入',acceptance:inspectionFixture.newAcceptance,steps:[{id:'read',title:'读取已有标记',owner:'开发者'}]});
        else if(turn===4)tool('inspection-new-read','read',{path:inspectionFixture.marker});
        else if(turn===5){assert.ok(JSON.stringify(body.messages).includes(inspectionFixture.markerLine.trim()));tool('inspection-new-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:['inspection-new-read']})}
        else if(turn===6)tool('inspection-new-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'只读核实已有标记为 '+inspectionFixture.markerLine.trim(),limitations:['未重放原命令，不表示原任务已完成业务验收']});
        else if(turn===7)reply('新周期只读证据已提交。');
        else throw Error('新核实不得重放成员：'+turn);
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Inspection cycle fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,releaseFresh,releaseOld,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{releaseFresh();releaseOld();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
