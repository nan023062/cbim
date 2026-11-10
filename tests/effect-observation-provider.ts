import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';

export const effectFixture={
  model:'effect-observation-fixture',
  oldGoal:'EFFECT_OLD: 创建隔离产物并保留真实执行事实',
  oldMemberGoal:'EFFECT_OLD_MEMBER: 仅执行一次隔离写入，不重试未知操作',
  file:'effect-artifact.json',editSeedText:'{"state":"before","count":0}\n',oldText:'{"state":"partial","count":1}\n',newText:'{"state":"repaired","count":2}\n',externalText:'{"state":"external","count":9}\n',
  inspectGoal:'EFFECT_INSPECT: 新只读周期核实 effect-artifact.json 的当前内容，不重放旧写入',
  inspectMemberGoal:'EFFECT_INSPECT_MEMBER: 真实读取旧影响产物，只提交新读取证据',
  repairGoal:'EFFECT_REPAIR: 新业务周期将 effect-artifact.json 修复为明确目标并重新读取验证',
  repairMemberGoal:'EFFECT_REPAIR_MEMBER: 独立写入修复内容并用本轮读取验证',
  otherGoal:'EFFECT_OTHER_ROOT: 独立会话仅回答，不执行旧任务',
  acceptance:['独立成员提交本轮实际文件读取证据，未知旧操作不能作为完成证明'],
  draft:'普通聊天草稿：观察和处置不能发送或清除这段文字。',
  observation:'当前文件存在，但原工具结束回执未收到；此观察不更改原 unknown。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** 本机确定性供应商只提出真实工具调用；旧写、只读核实、新修复都由实际 Pi 执行。 */
export async function effectObservationProvider(options:{unsupported?:boolean;edit?:boolean}={}){
  assert.ok(!(options.unsupported&&options.edit));
  const main:Request[]=[],member:Request[]=[],other:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',selection:OwnerExecutionSelection|undefined;
  const d=effectFixture;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)as Request;assert.equal(body.model,d.model);
    const auxiliary=JSON.stringify(body.messages).includes(d.otherGoal),isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true,list=auxiliary?other:isMain?main:member,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'effect-'+(main.length+member.length+other.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    const plan=(id:string,objective:string)=>{assert.ok(selection);tool(id,'cbim_goal_plan',goalPlanArguments({objective,agentId,moduleIds:[moduleId],ownerSelection:selection,acceptance:d.acceptance}))};
    const dispatch=(id:string,goal:string)=>{assert.ok(selection);tool(id,'cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection:selection,goal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]})};
    if(auxiliary){assert.equal(turn,0);reply('独立会话没有执行原来源的操作。')}
    else if(isMain){
      assert.ok(body.tools?.every(item=>!['cbim_task_help','cbim_task_checkpoint'].includes(item.function.name)));
      if(turn===0)plan('effect-old-plan',d.oldGoal);
      else if(turn===1)dispatch('effect-old-dispatch',d.oldMemberGoal);
      else if(turn===2)reply('原独立成员已派发，等待实际执行事实。');
      else if(turn===3)tool('effect-old-inspect','cbim_goal_inspect',{});
      else if(turn===4){const {scope}=goalInspection(body,'effect-old-inspect');tool('effect-old-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'原执行没有可供交付的完整成功证据',evidence:[]})),superseded:[],gaps:['存在文件影响，原结果不完整或失败，不能自动重放'],reason:'保留异常原事实，等待本机用户显式处置'})}
      else if(turn===5)reply('原任务失败关闭，文件影响与原未知状态均保留。');
      else if(turn===6){assert.ok(JSON.stringify(body.messages).includes(d.inspectGoal));assert.ok(body.messages.every(message=>message.role==='system'||message.role==='user'),'Fresh inspection may name the source call, but must not replay old assistant/tool history');plan('effect-inspect-plan',d.inspectGoal)}
      else if(turn===7)dispatch('effect-inspect-dispatch',d.inspectMemberGoal);
      else if(turn===8)reply('新只读核实已派发，不重复原操作。');
      else if(turn===9)tool('effect-inspect-goal','cbim_goal_inspect',{});
      else if(turn===10)tool('effect-inspect-review','cbim_goal_review',goalCompleteArguments(body,'effect-inspect-goal'));
      else if(turn===11)reply('新读取证据已核实；不据此把旧未知写入改成成功。');
      else if(turn===12){assert.ok(JSON.stringify(body.messages).includes(d.repairGoal));assert.ok(body.messages.every(message=>message.role==='system'||message.role==='user'),'Fresh repair must not inherit old assistant/tool history');plan('effect-repair-plan',d.repairGoal)}
      else if(turn===13)dispatch('effect-repair-dispatch',d.repairMemberGoal);
      else if(turn===14)reply('新的正式修复任务已独立派发。');
      else if(turn===15)tool('effect-repair-goal','cbim_goal_inspect',{});
      else if(turn===16)tool('effect-repair-review','cbim_goal_review',goalCompleteArguments(body,'effect-repair-goal'));
      else if(turn===17)reply('新修复目标已按新成员真实证据完成；旧操作和处置历史保持原样。');
      else throw Error('Unexpected main replay '+turn);
    }else{
      assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')&&!item.function.name.startsWith('cbim_goal_')));
      if(turn>=3&&turn<=7)assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('effect-old-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.oldMemberGoal,reason:'只执行一次原隔离操作',acceptance:d.acceptance,steps:[{id:'work',title:'写入隔离产物',owner:'开发者'}]});
      else if(turn===1){if(options.unsupported)tool('effect-old-command','bash',{command:`node -e "require('node:fs').writeFileSync('${d.file}','UNSUPPORTED_NATIVE_EFFECT');process.exit(17)"`});else if(options.edit)tool('effect-old-edit','edit',{path:d.file,edits:[{oldText:'"before"',newText:'"partial"'},{oldText:'"count":0',newText:'"count":1'}]});else tool('effect-old-write','write',{path:d.file,content:d.oldText})}
      else if(turn===2){const value=mainToolValue(body,options.unsupported?'effect-old-command':options.edit?'effect-old-edit':'effect-old-write');assert.ok(value);if(options.unsupported)assert.match(JSON.stringify(value),/17|exit|non-zero/i);emit({role:'assistant',content:'本轮未生成交付候选；保留已发生影响，不重试原调用。'});emit({},'length')}
      else if(turn===3)tool('effect-inspect-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.inspectMemberGoal,reason:'独立只读观察原文件',acceptance:d.acceptance,steps:[{id:'read',title:'读取当前产物',owner:'开发者'}]});
      else if(turn===4)tool('effect-inspect-read','read',{path:d.file});
      else if(turn===5){assert.ok(JSON.stringify(body.messages).includes('partial'));tool('effect-inspect-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:['effect-inspect-read']})}
      else if(turn===6)tool('effect-inspect-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'本轮真实读取当前 partial 文件',limitations:['不证明原写入全部成功，不授权原命令重放']});
      else if(turn===7)reply('只读核实候选已提交。');
      else if(turn===8)tool('effect-repair-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.repairMemberGoal,reason:'按新目标修复并重新读取，不沿旧native继续',acceptance:d.acceptance,steps:[{id:'repair',title:'写入修复内容并读取',owner:'开发者'}]});
      else if(turn===9)tool('effect-repair-write','write',{path:d.file,content:d.newText});
      else if(turn===10)tool('effect-repair-read','read',{path:d.file});
      else if(turn===11){assert.ok(JSON.stringify(body.messages).includes('repaired'));tool('effect-repair-inspect','cbim_task_inspect',{})}
      else if(turn===12){const progress=mainToolValue(body,'effect-repair-inspect');tool('effect-repair-step','cbim_task_step',{expectedVersion:progress.plan.version,id:'repair',state:'reported_done',evidenceIds:['effect-repair-read']})}
      else if(turn===13)tool('effect-repair-delivery','cbim_delivery_prepare',{expectedVersion:mainToolValue(body,'effect-repair-step').version,summary:'新文件 repaired/count=2 已真实读取',limitations:['新结果不更正原unknown，也不代替人工业务验收']});
      else if(turn===14)reply('新修复候选已提交。');
      else throw Error('Unexpected member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Effect fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,other,errors,bind:(agent:string,module:string,owner:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;selection=structuredClone(owner)},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
