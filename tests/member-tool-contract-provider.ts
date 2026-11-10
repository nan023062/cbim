import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolContractFixture as data,mainToolValue} from './main-tool-contract-provider';

export type MemberToolFault='help'|'checkpoint';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only model responses are deterministic. The test corrupts one returned value after real canonical staging. */
export async function memberToolContractProvider(mode:MemberToolFault){
  const main:Request[]=[],member:Request[]=[],errors:string[]=[],state:{fault?:unknown;denied?:unknown;baselineId?:string;progressVersion?:number}={};let ownerSelection:OwnerExecutionSelection|undefined;let agentId='',moduleId='';
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as Request;assert.equal(body.model,data.model);const isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true,list=isMain?main:member,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-contract-'+(main.length+member.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n'),tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(ownerSelection,'Fixture must bind an actual registered owner before business planning');
      assert.ok(body.tools?.every(item=>!['cbim_task_help','cbim_task_artifact_capture','cbim_task_checkpoint'].includes(item.function.name)));
      if(turn===0)tool('member-contract-goal-plan','cbim_goal_plan',goalPlanArguments({objective:data.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:data.acceptance}));
      else if(turn===1)tool('member-contract-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:data.memberGoal,acceptance:data.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('唯一任务已交给执行成员。');
      else if(turn===3)tool('member-contract-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4){const {scope,graph}=goalInspection(body,'member-contract-goal-inspect');assert.equal(graph.tasks.length,1);assert.equal(graph.tasks[0].status,'blocked');assert.equal(graph.tasks[0].result,undefined);assert.equal(graph.tasks[0].help,undefined);assert.equal(graph.tasks[0].checkpoints,undefined);tool('member-contract-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'成员输出失败，不能把暂存请求当作安全交接或业务候选',evidence:[]})),superseded:[],gaps:['须核实原执行记录，不自动重做请求'],reason:'保留原任务与失败回执，不自动派发或恢复'})}
      else if(turn===5)reply('目标尚未完成，原暂存记录已保留，不自动重试。');
      else throw Error('Unexpected main replay '+turn);
    }else{
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_task_help'));assert.ok(body.tools?.some(item=>item.function.name==='cbim_task_checkpoint'));
      if(turn===0)tool('member-contract-plan','cbim_task_plan',{expectedVersion:0,goal:data.memberGoal,reason:'以实际工具记录验证暂存后的输出失败',acceptance:data.acceptance,steps:[{id:'verify',title:'真实读取单个文件',owner:'开发者'}]});
      else if(mode==='help'){
        if(turn===1)tool('member-contract-read','read',{path:data.file});
        else if(turn===2)tool('member-contract-stage','cbim_task_help',{kind:'missing_input',reason:'需要主调度核实缺失条件，先安全结束当前执行轮',question:'后续任务应采用哪一项补充要求？',attemptedToolCallIds:['member-contract-read']});
        else if(turn===3){state.fault=mainToolValue(body,'member-contract-stage');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);tool('member-contract-after-stage','read',{path:data.file})}
        else if(turn===4){state.denied=mainToolValue(body,'member-contract-after-stage');assert.match(JSON.stringify(state.denied),/结束本轮|不能继续调用工具/);reply('原求助已暂存但回包失败，后续工具被门闩拒绝；现在结束本轮。')}
        else throw Error('Unexpected help replay '+turn);
      }else{
        if(turn===1)tool('member-contract-write','write',{path:data.file,content:data.fact});
        else if(turn===2)tool('member-contract-read','read',{path:data.file});
        else if(turn===3)tool('member-contract-inspect','cbim_task_inspect',{});
        else if(turn===4){const value=mainToolValue(body,'member-contract-inspect');assert.ok(Number.isSafeInteger(value.plan?.version));state.progressVersion=value.plan.version;tool('member-contract-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.progressVersion,sourceToolCallIds:['member-contract-write','member-contract-read']})}
        else if(turn===5){const value=mainToolValue(body,'member-contract-capture');assert.equal(value.state,'captured');state.baselineId=value.baseline.baselineId;tool('member-contract-stage','cbim_task_checkpoint',{expectedTaskProgressVersion:state.progressVersion,baselineId:state.baselineId,reason:'保存本次真实单文件操作，后续必须主调度明确预约'})}
        else if(turn===6){state.fault=mainToolValue(body,'member-contract-stage');assert.match(JSON.stringify(state.fault),/TOOL_OUTPUT_INVALID/);tool('member-contract-after-stage','read',{path:data.file})}
        else if(turn===7){state.denied=mainToolValue(body,'member-contract-after-stage');assert.match(JSON.stringify(state.denied),/结束本轮|不能再调用工具/);reply('原检查点已暂存但回包失败，后续工具被门闩拒绝；现在结束本轮。')}
        else throw Error('Unexpected checkpoint replay '+turn);
      }
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member tool contract fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
