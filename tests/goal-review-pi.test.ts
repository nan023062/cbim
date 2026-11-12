import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';

type ProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Test actual Pi/tool calls and reliable cycle close, with only the model transport replaced by localhost SSE. */
it.each(['missing-review','failed-member','forged-evidence','replan'] as const)('enforces the goal completion gate across main/member rounds (%s)',async(mode)=>{
  const f=await fixture(),mainGoal='GOAL_REVIEW_MAIN: 核实真实模块文件，必要时追加独立复核';
  const memberGoal='GOAL_REVIEW_MEMBER: 读取 review-input.txt 并提交实际证据';
  const queuedGoal='GOAL_REVIEW_QUEUED: 前项完成后再处理本项';
  const acceptance=['实际读取 review-input.txt 并提交证据'],fact='REAL_GOAL_REVIEW_FACT_67295';
  const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],errors:unknown[]=[];
  let moduleId='',agentId='',release=()=>{};let ownerSelection:OwnerExecutionSelection|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const requests=isMain?mainRequests:memberRequests,turn=requests.length;requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'goal-review-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        const plan=(revision:number)=>goalPlanArguments({objective:mainGoal,agentId,moduleIds:[moduleId],ownerSelection,acceptance},revision);
        const dispatch=()=>({agentId,moduleIds:[moduleId],ownerSelection,goal:memberGoal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
        if(turn===0)tool('goal-plan-first','cbim_goal_plan',plan(1));
        else if(turn===1)tool('goal-dispatch-first','cbim_dispatch_task',dispatch());
        else if(turn===2)reply('首批已派发，等待执行证据。');
        else if(mode==='forged-evidence'){
          if(turn===3)tool('goal-inspect-forgery','cbim_goal_inspect',{});
          else if(turn===4){
            const review=goalCompleteArguments(body,'goal-inspect-forgery');
            review.checks[0].evidence[0].resultId='invented-result-must-not-be-trusted';
            tool('goal-review-forged','cbim_goal_review',review);
          }else{
            expect(turn).toBeGreaterThanOrEqual(5);expect(turn).toBeLessThanOrEqual(7);
            expect(JSON.stringify(body.messages.filter(message=>message.role==='tool'&&message.tool_call_id==='goal-review-forged'))).toContain('GOAL_EVIDENCE_INVALID');
            if(turn>5)expect(JSON.stringify(body.messages.at(-1)?.content)).toContain('CBIM 最终验收未通过');
            reply('忽略证据失败，仍声明全部完成。');
          }
        }else if(mode!=='replan'){
          expect(turn).toBeGreaterThanOrEqual(3);expect(turn).toBeLessThanOrEqual(5);
          if(turn>3)expect(JSON.stringify(body.messages.at(-1)?.content)).toContain('CBIM 最终验收未通过');
          // 两次有界反馈仍不补证，必须失败；不能让测试供应商异常代替真实验收拒绝。
          reply('已经全部完成，可以处理排队要求。');
        }else if(turn===3)tool('goal-inspect-first','cbim_goal_inspect',{});
        else if(turn===4){
          const {scope}=goalInspection(body,'goal-inspect-first');
          tool('goal-review-replan','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'replan',checks:scope.goal.plan.criteria.map(item=>({criterionId:item.id,outcome:'unmet',reason:'尚需第二个独立执行实例复核',evidence:[]})),superseded:[],gaps:['需要独立复核实际内容'],reason:'首批已返回，继续同一用户目标并追加验证'});
        }else if(turn===5)tool('goal-plan-second','cbim_goal_plan',plan(3));
        else if(turn===6)tool('goal-dispatch-second','cbim_dispatch_task',dispatch());
        else if(turn===7)reply('已按新计划追加复核，不提前宣称完成。');
        else if(turn===8)tool('goal-inspect-final','cbim_goal_inspect',{});
        else if(turn===9)tool('goal-review-complete','cbim_goal_review',goalCompleteArguments(body,'goal-inspect-final'));
        else if(turn===10)reply('原目标已核实，两次独立执行证据齐备。');
        else if(turn===11){expect(JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content)).toContain(queuedGoal);reply('排队目标现在单独处理。')}
        else throw Error('Unexpected goal main turn '+turn);
      }else{
        expect(body.tools?.some(tool=>tool.function.name.startsWith('cbim_goal_'))).toBe(false);
        const batch=Math.floor(turn/5),step=turn%5,id='goal-member-'+batch;
        if(step===0)tool(id+'-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'执行本周期受托目标',acceptance,steps:[{id:'verify',title:'核实真实文件',owner:'开发者'}]});
        else if(step===1){
          if(batch===0){emit({role:'assistant',content:'等待读取验证。'});await gate}
          if(mode==='failed-member'){emit({role:'assistant',content:'执行提供商拒绝响应'},'length')}
          else tool(id+'-read','read',{path:'review-input.txt'});
        }else if(step===2){expect(JSON.stringify(body.messages)).toContain(fact);tool(id+'-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[id+'-read']})}
        else if(step===3)tool(id+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'已核实文件内容 '+fact,limitations:['不代替人工业务验收']});
        else reply('读取证据已提交。');
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(error);if(!res.headersSent)res.writeHead(500);res.end('Goal review fixture failed')}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Provider did not bind');
    await f.app.models.save({profile:{name:'Goal review fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'goal-fixture',models:[{id:'goal-fixture',name:'Goal fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);moduleId=team.input.moduleId;agentId=team.input.agentId;
    const snapshot=await workspace.snapshot(),modulePath=moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'goal-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'goal-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    ownerSelection=(await registerExplicitFixtureOwner(f.app,entry.id,{agentId,moduleIds:[moduleId],profileId:(await f.app.models.list()).selectedId!,modelId:'goal-fixture'})).selection;
    await fs.writeFile(path.join(f.a,'review-input.txt'),fact);
    const scopes=async()=>{
      // Never open a recovering store over an active writer; only read complete committed records.
      const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),records:DispatchScope[]=[];
      for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
        const {body}=JSON.parse(line);expect(body.workspaceId).toBe(entry.id);records.push(...(body.mutation.scopes??[]));
      }
      return {records,current:[...new Map(records.map(scope=>[scope.scopeId,scope])).values()]};
    };
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:20000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(mainRequests).toHaveLength(3);expect(memberRequests).toHaveLength(2)},{timeout:20000,interval:30});
    const queued=await f.app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:started.runId,message:queuedGoal,options:{permission:'read',turnTimeoutMs:20000}});
    expect(queued.queued).toBe(true);expect((await scopes()).current).toHaveLength(1);
    release();
    await vi.waitFor(async()=>{
      const current=(await scopes()).current;expect(current).toHaveLength(mode==='replan'?2:1);expect(current.every(scope=>scope.status==='closed')).toBe(true);
      expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0);
    },{timeout:45000,interval:50});
    const {current,records}=await scopes(),snapshotGraph=await graph(),first=current[0];
    expect(first.goal?.input).toEqual({message:mainGoal,attachmentIds:[]});
    expect(snapshotGraph.tasks.every(task=>task.scopeId===first.scopeId)).toBe(true);
    const thread=await f.app.execution(entry.id).thread(started.taskId);
    if(mode==='replan'){
      expect(first).toMatchObject({outcome:'completed',goal:{revision:5,plan:{revision:4},review:{revision:5,planRevision:4,decision:'complete'}}});
      const decisions=records.filter(scope=>scope.scopeId===first.scopeId&&scope.status==='active');
      expect(decisions).toContainEqual(expect.objectContaining({goal:expect.objectContaining({revision:3,review:expect.objectContaining({decision:'replan'})})}));
      const newPlan=decisions.find(scope=>scope.goal?.revision===4);expect(newPlan?.goal?.review).toBeUndefined();
      expect(snapshotGraph.tasks).toHaveLength(2);expect(snapshotGraph.tasks.every(task=>task.status==='result_ready')).toBe(true);
      expect(new Set(snapshotGraph.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(2);
      expect(current[1]).toMatchObject({scopeId:expect.any(String),outcome:'completed',goal:{revision:1,input:{message:queuedGoal,attachmentIds:[]}}});
      expect(current[1].scopeId).not.toBe(first.scopeId);
      expect(thread.map(run=>run.source?.kind)).toEqual([undefined,'member-results','member-results',undefined]);
      expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).toEqual([]);
      expect(mainRequests).toHaveLength(12);expect(memberRequests).toHaveLength(10);
    }else{
      expect(first).toMatchObject({outcome:'failed',goal:{revision:2,blocked:{reason:expect.any(String)}}});
      expect(first.goal?.review).toBeUndefined();expect(snapshotGraph.tasks).toHaveLength(1);
      expect(snapshotGraph.tasks[0].status).toBe(mode==='failed-member'?'failed':'result_ready');
      expect(thread).toHaveLength(4);expect(thread[1].source?.kind).toBe('member-results');
      expect(thread.slice(2).map(run=>run.source)).toEqual([1,2].map(attempt=>expect.objectContaining({kind:'goal-repair',scopeId:first.scopeId,attempt,failureCode:'GOAL_REVIEW_REQUIRED'})));
      expect(thread.every(run=>run.status==='completed')).toBe(true);
      expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).toEqual([expect.objectContaining({message:queuedGoal,status:'paused'})]);
      expect(mainRequests).toHaveLength(mode==='forged-evidence'?8:6);expect(memberRequests).toHaveLength(mode==='failed-member'?2:5);
    }
    const monitored=f.app.runtime.snapshot().members;
    expect(snapshotGraph.tasks.every(task=>monitored.find(agent=>agent.agentInstanceId===task.assignee.agentInstanceId)?.lifecycle==='released')).toBe(true);
    expect(monitored.find(agent=>agent.agentInstanceId===snapshotGraph.root.agent.agentInstanceId)?.lifecycle).not.toBe('released');
    const requestCount=mainRequests.length+memberRequests.length;await f.app.open(entry.id,true);
    expect((await scopes()).current).toEqual(current);expect((await graph()).tasks).toEqual(snapshotGraph.tasks);
    expect(mainRequests.length+memberRequests.length).toBe(requestCount);expect(errors).toEqual([]);
  }finally{release();await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},120000);
