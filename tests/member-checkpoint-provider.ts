import {DependencyReviewRounds,serveFixtureCompaction} from './dependency-review-provider-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {memberCheckpointResultSchema} from '../src/logic/tasks/rules/member-checkpoint';

export type CheckpointFixtureMode='complete'|'stop'|'restart'|'command-rejected';
export const memberCheckpointFixture={
  goal:'MEMBER_CHECKPOINT_MAIN: A保存检查点后沿原任务继续，再按依赖首次执行B和C',
  goals:['MEMBER_CHECKPOINT_A: 单文件写入一次，安全保存检查点后继续读取验证','MEMBER_CHECKPOINT_B: 等待A的最终新候选，再读取第二份材料','MEMBER_CHECKPOINT_C: 等待B的最终候选，再读取第三份材料'],
  files:['member-checkpoint-marker.txt','member-checkpoint-b.txt','member-checkpoint-c.txt'],
  facts:['MEMBER_CHECKPOINT_WRITE_ONCE_86c2','MEMBER_CHECKPOINT_B_27b1','MEMBER_CHECKPOINT_C_914f'],
  model:'member-checkpoint-fixture',acceptance:['依照前置真实候选验证三份文件，保留检查点和新旧运行关系'],
  reason:'单文件变更已读取并采集，暂存执行进度并释放本轮占用；后续须主调度明确继续。',
  resumeReason:'原目标、模块及角色不变，按已核实检查点继续原成员任务，并以新读取验证。',
  draft:'保留对话草稿；成员检查点和续执行不应自动发送此内容。',
  final:'已沿同一成员任务继续，旧写入未重放，B和C均按新候选完成。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function toolValue(request:Request,id:string):any{
  const item=request.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(item,'Missing actual tool response '+id);
  const text=typeof item.content==='string'?item.content:Array.isArray(item.content)?item.content.map(value=>value&&typeof value==='object'&&'text' in value?String(value.text):'').join(''):'';
  const parse=(value:string)=>{try{return JSON.parse(value)}catch{return {error:value}}};
  let result=parse(text);if(Array.isArray(result.content))result=parse(result.content.filter((value:{type:string})=>value.type==='text').map((value:{text:string})=>value.text).join(''));return result;
}

/** File writes/reads, resume sessions and scheduler are real; only local model output is scripted. */
export async function memberCheckpointProvider(mode:CheckpointFixtureMode='complete',extraCheckpoint=false){
  const d=memberCheckpointFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];
  let agentId='',moduleId='',releaseCheckpoint=()=>{},releaseResume=()=>{};
  const checkpointGate=new Promise<void>(resolve=>{releaseCheckpoint=resolve}),resumeGate=new Promise<void>(resolve=>{releaseResume=resolve});
  const state:{baseline?:any;checkpoint?:unknown;checkpointRejected?:unknown;parked?:GraphSnapshot;resume?:any;resumeProgressVersion?:number;initialProgressVersion?:number;thirdContext?:Request}={};
  let ownerSelection:OwnerExecutionSelection|undefined;
  const reviews=new DependencyReviewRounds();
  const compactions:GoalFixtureRequest[]=[];
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,list=isMain?main:member,turn=list.length-(isMain?reviews.offset:0);if(serveFixtureCompaction(body,res,compactions))return;list.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-checkpoint-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if((isMain)&&reviews.handle(body,'checkpoint-final-inspect',tool,reply)){res.end('data: [DONE]\n\n');return}
    if(isMain){
      assert.ok(body.tools?.every(tool=>!['cbim_task_checkpoint'].includes(tool.function.name)));
      if(turn===0)tool('checkpoint-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
      else if(turn>=1&&turn<=3){const prerequisites=turn===1?[]:[{taskId:toolValue(body,'checkpoint-dispatch-'+(turn-1)).taskId,expectedPlanRevision:1}];tool('checkpoint-dispatch-'+turn,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.goals[turn-1],acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites})}
      else if(turn===4)reply('已依次登记A、B和C，等待A的真实运行结果。');
      else if(turn===5)tool('checkpoint-goal-inspect','cbim_goal_inspect',{});
      else if(turn===6){
        const {scope,graph}=goalInspection(body,'checkpoint-goal-inspect');state.parked=graph;const task=graph.tasks.find(value=>value.goal===d.goals[0]);assert.ok(task);
        if(mode==='command-rejected'){
          assert.equal(task.status,'failed');assert.equal(task.checkpoints?.length??0,0);
          tool('checkpoint-rejected-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'命令影响范围不可由局部文件基线证明，检查点被拒绝',evidence:[]})),superseded:[],gaps:['不能对范围不明操作创建恢复检查点'],reason:'保持失败事实，不恢复或重放旧命令'});
        }else{
          assert.equal(task.status,'checkpointed');assert.equal(task.checkpoints?.length,1);assert.equal(task.result,undefined);assert.equal(task.help,undefined);
          emit({role:'assistant',content:'成员检查点已安全确认；等待本机测试允许明确续执行。'});await checkpointGate;
          tool('checkpoint-resume','cbim_dispatch_resume',{expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:scope.goal.revision,taskId:task.taskId,expectedRevision:task.revision,checkpointId:task.checkpoints![0].checkpointId,reason:d.resumeReason});
        }
      }else if(turn===7){
        if(mode==='command-rejected')reply('检查点未创建，原命令不重放。');
        else{state.resume=toolValue(body,'checkpoint-resume');assert.equal(typeof state.resume.requestId,'string');emit({role:'assistant',content:'续执行已经排入，主轮尚未结束。'});await resumeGate;reply('本次主调度安排完成，继续原A并推进B和C。')}
      }else if(turn===8)tool('checkpoint-final-inspect','cbim_goal_inspect',{});
      else if(turn===9)tool('checkpoint-final-review','cbim_goal_review',goalCompleteArguments(body,'checkpoint-final-inspect'));
      else if(turn===10)reply(d.final);
      else throw Error('Unexpected main replay '+turn);
    }else if(turn===0)tool('checkpoint-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[0],acceptance:d.acceptance,reason:'一次单文件写入，按真实记录停泊后继续',steps:[{id:'verify',title:'写入后读取验证',owner:'开发者'}]});
    else if(turn===1){
      if(mode==='command-rejected')tool('checkpoint-command','bash',{command:`node -e "require('node:fs').writeFileSync('${d.files[0]}','${d.facts[0]}')"`});
      else tool('checkpoint-write','write',{path:d.files[0],content:d.facts[0]});
    }else if(turn===2)tool('checkpoint-read','read',{path:d.files[0]});
    else if(turn===3)tool('checkpoint-progress','cbim_task_inspect',{});
    else if(turn===4){const inspected=toolValue(body,'checkpoint-progress');assert.ok(Number.isSafeInteger(inspected.plan?.version));state.initialProgressVersion=inspected.plan.version;tool('checkpoint-artifact','cbim_task_artifact_capture',{expectedTaskProgressVersion:inspected.plan.version,sourceToolCallIds:mode==='command-rejected'?['checkpoint-read']:['checkpoint-write','checkpoint-read']})}
    else if(turn===5){state.baseline=toolValue(body,'checkpoint-artifact');assert.equal(state.baseline.state,'captured');tool('checkpoint-request','cbim_task_checkpoint',{expectedTaskProgressVersion:state.initialProgressVersion,baselineId:state.baseline.baseline.baselineId,reason:d.reason})}
    else if(turn===6){
      const value=toolValue(body,'checkpoint-request');
      if(mode==='command-rejected'){assert.notEqual(value.state,'staged');assert.match(JSON.stringify(value),/未知影响|命令/);state.checkpointRejected=value;emit({role:'assistant',content:'范围不明命令不满足文件限定检查点，不能声称安全停泊。'});emit({},'length')}
      else{state.checkpoint=memberCheckpointResultSchema.parse(value);reply('请求已暂存，本轮正常结束，后续由主调度决定。')}
    }else if(turn===7){assert.ok(JSON.stringify(body.messages).includes(d.reason),'续轮必须有原生历史');tool('checkpoint-resumed-inspect','cbim_task_inspect',{})}
    else if(turn===8){const inspected=toolValue(body,'checkpoint-resumed-inspect');assert.ok(Number.isSafeInteger(inspected.plan?.version));assert.ok(inspected.plan.version>state.initialProgressVersion!);assert.deepEqual(inspected.evidence,[]);assert.ok(inspected.plan.steps.every((step:{evidence:string[]})=>step.evidence.length===0));state.resumeProgressVersion=inspected.plan.version;tool('checkpoint-resumed-read','read',{path:d.files[extraCheckpoint?1:0]})}
    else if(turn===9){if(extraCheckpoint)tool('checkpoint-second-artifact','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.resumeProgressVersion,sourceToolCallIds:['checkpoint-resumed-read']});else tool('checkpoint-resumed-step','cbim_task_step',{expectedVersion:state.resumeProgressVersion,id:'verify',state:'reported_done',evidenceIds:['checkpoint-resumed-read']})}
    else if(turn===10){if(extraCheckpoint){const captured=toolValue(body,'checkpoint-second-artifact');assert.equal(captured.state,'captured');tool('checkpoint-second-request','cbim_task_checkpoint',{expectedTaskProgressVersion:state.resumeProgressVersion,baselineId:captured.baseline.baselineId,reason:'第二段只读取另一文件，保存检查点等待用户再次明确继续。'})}else tool('checkpoint-resumed-delivery','cbim_delivery_prepare',{expectedVersion:state.resumeProgressVersion!+1,summary:'沿原成员会话重新读取验证，原写入不重复',limitations:['检查点和文件字节不代替人工业务验收']})}
    else if(turn===11){if(extraCheckpoint){memberCheckpointResultSchema.parse(toolValue(body,'checkpoint-second-request'));reply('第二段请求已暂存，等待主调度。')}else reply('A续轮已提交新读取候选。')}
    else if(extraCheckpoint&&turn>=12&&turn<=16){
      if(turn===12){state.thirdContext=body;assert.ok(JSON.stringify(body.messages).includes('第二段只读取另一文件'));tool('checkpoint-third-inspect','cbim_task_inspect',{})}
      else if(turn===13){const progress=toolValue(body,'checkpoint-third-inspect');assert.deepEqual(progress.evidence,[]);assert.ok(progress.plan.version>state.resumeProgressVersion!);state.resumeProgressVersion=progress.plan.version;tool('checkpoint-third-read','read',{path:d.files[0]})}
      else if(turn===14)tool('checkpoint-third-step','cbim_task_step',{expectedVersion:state.resumeProgressVersion,id:'verify',state:'reported_done',evidenceIds:['checkpoint-third-read']});
      else if(turn===15)tool('checkpoint-third-delivery','cbim_delivery_prepare',{expectedVersion:state.resumeProgressVersion!+1,summary:'第三段重新读取原文件，全部旧日志保留',limitations:[]});
      else reply('A第三段以本轮新证据交付。');
    }
    else if(turn>=(extraCheckpoint?17:12)&&turn<=(extraCheckpoint?26:21)){
      const relative=turn-(extraCheckpoint?5:0),index=relative<17?1:2,stage=(relative-(index===1?12:17)),prefix='checkpoint-'+(index===1?'b':'c');
      if(stage===0)tool(prefix+'-plan','cbim_task_plan',{expectedVersion:0,goal:d.goals[index],acceptance:d.acceptance,reason:'等待真实前置结果后首次执行',steps:[{id:'verify',title:'读取独立材料',owner:'开发者'}]});
      else if(stage===1)tool(prefix+'-read','read',{path:d.files[index]});
      else if(stage===2)tool(prefix+'-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[prefix+'-read']});
      else if(stage===3)tool(prefix+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'已读取真实后继材料 '+d.facts[index],limitations:[]});
      else reply('后继任务首次执行完成。');
    }else throw Error('Unexpected member replay '+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Member checkpoint fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {compactions,reviews,url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},releaseCheckpoint:()=>releaseCheckpoint(),releaseResume:()=>releaseResume(),close:async()=>{releaseCheckpoint();releaseResume();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
