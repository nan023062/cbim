import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const reportFixture={
  mainGoal:'EXECUTION_REPORT_MAIN: 执行隔离验证并如实核实工具结果',
  memberGoal:'EXECUTION_REPORT_MEMBER: 执行隔离业务操作并保留真实证据',
  acceptance:['操作有可追溯的真实工具回执'],
  marker:'execution-report-marker.txt',
  fact:'EXECUTION_REPORT_PARTIAL_EFFECT_9af0',
  pending:'工具已返回，正在核实本轮状态。',
  failure:'业务命令失败且已写入文件；不能将失败理解为没有发生修改。',
  final:'只汇报真实执行事实，不自动重试失败操作。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only model transport is deterministic: native bash/read, policy, receipts and disk effects remain real. */
export async function executionReportProvider(options:{success?:boolean;hold?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as Request,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const list=isMain?mainRequests:memberRequests,turn=list.length;list.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'execution-report-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        if(turn===0)tool('report-plan','cbim_goal_plan',goalPlanArguments({objective:reportFixture.mainGoal,agentId,moduleIds:[moduleId],acceptance:reportFixture.acceptance}));
        else if(turn===1)tool('report-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:reportFixture.memberGoal,acceptance:reportFixture.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        else if(turn===2)reply('已派发，等待真实工具结果。');
        else if(turn===3)tool('report-inspect','cbim_goal_inspect',{});
        else if(turn===4){
          if(options.success)tool('report-review','cbim_goal_review',goalCompleteArguments(body,'report-inspect'));
          else{
            const {scope}=goalInspection(body,'report-inspect');
            tool('report-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:reportFixture.failure,evidence:[]})),superseded:[],gaps:[reportFixture.failure],reason:reportFixture.failure});
          }
        }else if(turn===5)reply(reportFixture.final);
        else throw Error('只读报告不得触发额外主模型请求：'+turn);
      }else{
        if(turn===0)tool('report-member-plan','cbim_task_plan',{expectedVersion:0,goal:reportFixture.memberGoal,reason:'验证真实执行记录，不重试已失败命令',acceptance:reportFixture.acceptance,steps:[{id:'verify',title:'执行隔离操作',owner:'开发者'}]});
        else if(turn===1){
          if(options.success)tool('report-business-read','read',{path:'execution-report-input.txt'});
          else tool('report-business-command','bash',{command:`node -e "require('node:fs').writeFileSync('${reportFixture.marker}','${reportFixture.fact}');process.exit(17)"`});
        }else if(turn===2){
          const result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===(options.success?'report-business-read':'report-business-command'));
          assert.ok(result,'必须先收到真实工具结果');
          if(options.hold){emit({role:'assistant',content:reportFixture.pending});await gate}
          if(options.success){assert.ok(JSON.stringify(result.content).includes(reportFixture.fact));tool('report-member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['report-business-read']})}
          else{assert.ok(/17|non-zero|exit/i.test(JSON.stringify(result.content)));emit({role:'assistant',content:reportFixture.failure});emit({},'length')}
        }else if(turn===3&&options.success)tool('report-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'读取真实文件 '+reportFixture.fact,limitations:['工具回执不代替人工业务验收']});
        else if(turn===4&&options.success)reply('真实读取已提交候选。');
        else throw Error('只读报告不得重放成员：'+turn);
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Execution report fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,release,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
