import assert from 'node:assert/strict';
import http from 'node:http';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {ownerExecutionDiscoverySchema,type OwnerExecutionDiscovery} from '../src/backend/core/team/owner-execution-discovery';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {goalInspection,type GoalFixtureRequest} from './goal-provider-fixture';
import {ownerExecutionData as data} from './owner-execution-fixture';

export type OwnerExecutionMode='complete'|'owner-before-claim'|'profile-before-claim'|'profile-after-claim'|'stop'|'bad-wire';
export type OwnerExecutionRequest=GoalFixtureRequest&{model:string;tools?:Array<{function:{name:string}}>};
export function ownerExecutionToolValue(body:OwnerExecutionRequest,id:string):any{
  const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);assert.ok(message,'Missing actual tool response: '+id);
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';
  const parse=(text:string)=>{try{return JSON.parse(text)}catch{return {error:text}}};
  let parsed=parse(text);if(Array.isArray(parsed.content))parsed=parse(parsed.content.filter((value:{type:string})=>value.type==='text').map((value:{text:string})=>value.text).join(''));
  return parsed;
}

/** The provider chooses calls only. Real owner selections and result references are read from actual tool replies, never supplied by the fixture. */
export async function ownerExecutionProvider(mode:OwnerExecutionMode='complete'){
  const main:OwnerExecutionRequest[]=[],members:[OwnerExecutionRequest[],OwnerExecutionRequest[]]=[[],[]],errors:string[]=[],sequence:string[]=[],httpRequests:Array<{path:string;model:string}>=[];
  const state:{discovery?:OwnerExecutionDiscovery;selections?:OwnerExecutionSelection[];before?:GraphSnapshot;final?:GraphSnapshot;held?:boolean;review?:unknown;badWire?:unknown}={};
  let agentId='',modules:string[]=[],releaseMain!:()=>void,releaseMembers!:()=>void;
  const mainGate=new Promise<void>(resolve=>releaseMain=resolve),memberGate=new Promise<void>(resolve=>releaseMembers=resolve);
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as OwnerExecutionRequest;
    const endpoint=req.url??'',isMain=endpoint==='/main/v1/chat/completions',index=endpoint==='/b/v1/chat/completions'?1:0;
    assert.ok(isMain||endpoint==='/a/v1/chat/completions'||endpoint==='/b/v1/chat/completions','Request used an unexpected profile route: '+endpoint);assert.equal(body.model,isMain?data.mainModel:data.models[index]);
    const requests=isMain?main:members[index],turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member-'+index}:${turn}`);httpRequests.push({path:endpoint,model:body.model});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'owner-execution-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.some(item=>item.function.name==='cbim_module_owner_inspect'));
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool('execution-owner-discovery','cbim_module_owner_inspect',{moduleIds:modules});
      else if(turn===1){
        const output=ownerExecutionToolValue(body,'execution-owner-discovery'),discovery=ownerExecutionDiscoverySchema.parse(output.execution);state.discovery=discovery;
        assert.equal(discovery.groups.length,2);state.selections=modules.map(moduleId=>{const group=discovery.groups.find(group=>group.moduleIds.includes(moduleId));assert.ok(group);assert.equal(group.agentId,agentId);assert.deepEqual(group.issues,[]);assert.ok(group.selection);return group.selection});
        assert.notEqual(state.selections[0].memberId,state.selections[1].memberId);
        tool('execution-owner-plan','cbim_goal_plan',{
          expectedRevision:1,objective:data.goal,constraints:['仅按已登记责任派发，各岗位使用自身模型和项目适配'],
          criteria:modules.map((_,index)=>({id:'owner-criterion-'+index,text:data.acceptance[0],kind:'evidence'})),
          assignments:modules.map((moduleId,index)=>({agentId,moduleIds:[moduleId],ownerSelection:state.selections![index],criterionIds:['owner-criterion-'+index],reason:'使用此模块真实查询所得负责岗位，不按 Agent 合并岗位'})),
          reason:'先保存实际岗位与责任版本，再派发各自材料核实任务',
        });
      }else if(turn===2||turn===3){
        const index=turn-2;assert.ok(state.selections);tool('execution-owner-dispatch-'+index,'cbim_dispatch_task',{agentId,moduleIds:[modules[index]],ownerSelection:state.selections[index],goal:data.goals[index],acceptance:data.acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
      }else if(turn===4){
        if(mode==='bad-wire'){const value=ownerExecutionToolValue(body,'execution-owner-dispatch-0');assert.ok(JSON.stringify(value).includes('TOOL_OUTPUT_INVALID'));state.badWire=value}
        tool('execution-owner-before','cbim_goal_inspect',{});
      }else if(turn===5){
        const {graph}=goalInspection(body,'execution-owner-before');assert.equal(graph.tasks.length,2);assert.ok(graph.tasks.every(task=>task.runIds.length===0));state.before=structuredClone(graph);state.held=true;
        emit({role:'assistant',content:data.held});await mainGate;reply('主轮已结束，请按已保存的各岗位配置执行。');
      }else if(turn===6)tool('execution-owner-final','cbim_goal_inspect',{});
      else if(turn===7){
        const {scope,graph}=goalInspection(body,'execution-owner-final');state.final=graph;
        const stale=mode==='owner-before-claim'||mode==='profile-before-claim';
        if(stale){
          assert.ok(graph.tasks.some(task=>task.status!=='result_ready'));state.review={expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'旧任务负责岗位或模型预期已经变化，不能暗中换配置执行',evidence:[]})),superseded:[],gaps:['需明确核实责任与配置后重新规划；原任务和记录保持'],reason:'原计划的领取条件已失效，保留真实失败而不伪造完成'};
        }else{
          assert.ok(graph.tasks.every(task=>task.status==='result_ready'&&task.result));state.review={expectedRevision:scope.goal.revision,decision:'complete',checks:modules.map((moduleId,index)=>{
            const task=graph.tasks.find(task=>task.modules.length===1&&task.modules[0].moduleId===moduleId);assert.ok(task?.result);assert.ok(task.result.evidenceRefs.length);
            return {criterionId:'owner-criterion-'+index,outcome:'satisfied',reason:'核对该岗位原任务的真实读取结果，不把同 Agent 的另一岗位结果混用',evidence:[{kind:'member-result',taskId:task.taskId,runId:task.result.runId,resultId:task.result.resultId,planRevision:task.result.planRevision,toolCallIds:task.result.evidenceRefs}]};
          }),superseded:[],gaps:[],reason:'两个岗位分别提供当前目标的真实读取证据'};
        }
        tool('execution-owner-review','cbim_goal_review',state.review);
      }else if(turn===8){const review=ownerExecutionToolValue(body,'execution-owner-review');assert.ok(!review.error,JSON.stringify(review));reply(mode==='owner-before-claim'||mode==='profile-before-claim'?'原岗位执行条件变化，目标保持未完成，需要重新规划。':data.final)}
      else throw Error('Unexpected main replay: '+turn);
    }else{
      const context=JSON.stringify(body.messages);assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')&&!item.function.name.startsWith('cbim_module_owner_')));
      if(turn===0){
        assert.ok(context.includes(data.adaptations[index]),'The actual model input omitted position adaptation');assert.ok(!context.includes(data.adaptations[1-index]),'Another position adaptation leaked into this model input');
        assert.ok(context.includes(data.sharedSkill),'Inherited Skill text was not supplied');assert.ok(context.includes(data.ownSkill),'Agent Skill text was not supplied');assert.ok(context.includes(data.goals[index]));
        if(mode==='profile-after-claim'){emit({role:'assistant',content:'岗位已实际领取，等候本地配置竞争检查。'});await memberGate}
        tool('execution-worker-'+index+'-plan','cbim_task_plan',{expectedVersion:0,goal:data.goals[index],acceptance:[...data.acceptance],reason:'按照本岗位冻结模型和适配读取实际材料',steps:[{id:'verify',title:'读取该岗位模块材料',owner:'开发者'}]});
      }else if(turn===1)tool('execution-worker-'+index+'-read','read',{path:data.files[index]});
      else if(turn===2){assert.ok(context.includes(data.facts[index]));tool('execution-worker-'+index+'-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['execution-worker-'+index+'-read']})}
      else if(turn===3)tool('execution-worker-'+index+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:data.facts[index],limitations:['本地确定性供应商仅驱动实际调用；结果不是人工业务验收']});
      else if(turn===4)reply('本岗位已提交真实读取候选。');
      else throw Error('Unexpected member replay: '+index+':'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Owner execution fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  return {urls:{main:base+'/main/v1',a:base+'/a/v1',b:base+'/b/v1'},main,members,errors,sequence,httpRequests,state,bind:(agent:string,moduleIds:readonly string[])=>{agentId=agent;modules=[...moduleIds]},releaseMain,releaseMembers,close:async()=>{releaseMain();releaseMembers();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
