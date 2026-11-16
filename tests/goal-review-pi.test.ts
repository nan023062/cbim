import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {json} from '../src/core/platform/node/serialization';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';

type ProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Test actual Pi/tool calls and reliable cycle close, with only the model transport replaced by localhost SSE. */
it.each(['missing-review','failed-member','forged-evidence','replan'] as const)('verifies original recursive delivery without old goal review or repair rounds (%s)',async(mode)=>{
  const f=await fixture(),mainGoal='GOAL_REVIEW_MAIN: 核实真实模块文件，必要时追加独立复核';
  const memberGoal='GOAL_REVIEW_MEMBER: 读取 review-input.txt 并提交实际证据';
  const acceptance=['实际读取 review-input.txt 并提交证据'],fact='REAL_GOAL_REVIEW_FACT_67295';
  const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],errors:unknown[]=[];
  let moduleId='',agentId='',release=()=>{};let ownerSelection:OwnerExecutionSelection|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest,isMain=body.tools?.some(tool=>tool.function.name==='cbim_agent_result_review')===true;
      const requests=isMain?mainRequests:memberRequests,turn=requests.length;requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'goal-review-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      if(isMain){
        expect(body.tools?.some(t=>t.function.name.startsWith('cbim_goal_'))).toBe(false);
        const call=(id:string)=>tool(id,'cbim_agent_call',{agentId:ownerSelection!.memberId,message:memberGoal,business:{moduleIds:[moduleId],acceptance}});
        if(turn===0)call('goal-call-first');
        else if(turn===1){
          const result=mainToolValue(body,'goal-call-first');
          if(mode==='failed-member'){expect(result.status).not.toBe('completed');expect(result.verification).toBeUndefined();reply('执行没有完成，保留失败记录，未自动返工。')}
          else{
            expect(result.verification).toMatchObject({state:'verified',acceptance:'not_evaluated'});
            if(mode==='forged-evidence')tool('goal-check-forged','cbim_agent_result_check',{callId:'invented-call-must-not-be-trusted'});
            else if(mode==='replan')call('goal-call-second');
            else reply('实际读取已完成；未请求人工评价，不宣称已获人工验收。');
          }
        }else if(turn===2&&mode==='forged-evidence'){expect(JSON.stringify(mainToolValue(body,'goal-check-forged'))).toContain('AGENT_RESULT_UNAVAILABLE');reply('无法核实不存在的调用，未生成验收事实。')}
        else if(turn===2&&mode==='replan'){expect(mainToolValue(body,'goal-call-second').verification).toMatchObject({state:'verified',acceptance:'not_evaluated'});reply('同一用户目标的两个独立核实调用都已返回真实证据。')}
        else throw Error('Unexpected recursive main replay '+turn);
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
    await f.app.models.Save({profile:{name:'Goal review fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'goal-fixture',models:[{id:'goal-fixture',name:'Goal fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace);moduleId=team.input.moduleId;agentId=team.input.agentId;
    const snapshot=await workspace.Snapshot(),modulePath=moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'goal-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'goal-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
    await workspace.Commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    ownerSelection=(await registerExplicitFixtureOwner(f.app,entry.id,{agentId,moduleIds:[moduleId],profileId:(await f.app.models.List()).selectedId!,modelId:'goal-fixture'})).selection;
    await fs.writeFile(path.join(f.a,'review-input.txt'),fact);
    const scopes=async()=>{
      // Never open a recovering store over an active writer; only read complete committed records.
      const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),records:DispatchScope[]=[];
      for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
        const {body}=JSON.parse(line);expect(body.workspaceId).toBe(entry.id);records.push(...(body.mutation.scopes??[]));
      }
      return {records,current:[...new Map(records.map(scope=>[scope.scopeId,scope])).values()]};
    };
    const started=await f.app.Dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:20000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>f.app.Dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await vi.waitFor(()=>{expect(errors).toEqual([]);expect(mainRequests).toHaveLength(1);expect(memberRequests).toHaveLength(2)},{timeout:20000,interval:30});
    release();
    await vi.waitFor(async()=>{
      expect(errors).toEqual([]);const current=(await scopes()).current;
      expect(current).toHaveLength(1);expect(current[0].status).toBe('closed');expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);
    },{timeout:45000,interval:50});
    const {current}=await scopes(),snapshotGraph=await graph(),first=current[0],thread=await f.app.Execution(entry.id).Thread(started.taskId);
    expect(first.outcome).toBe('completed');expect(first.goal?.input).toEqual({message:mainGoal,attachmentIds:[]});
    expect(first.goal?.plan).toBeUndefined();expect(first.goal?.review).toBeUndefined();expect(snapshotGraph.tasks).toEqual([]);
    expect(thread).toHaveLength(1);expect(thread[0].runId).toBe(started.runId);
    const state=await workspace.dispatchStore.Read(),runs=state.agentBusinessRuns!;
    expect(runs).toHaveLength(mode==='replan'?2:1);expect(state.runs??[]).toEqual([]);
    const summaries=[];
    for(const [index,run] of runs.entries()){
      expect(run.status).toBe('closed');expect(run.parent).toMatchObject({callerRunId:started.runId,toolCallId:index?'goal-call-second':'goal-call-first'});
      const summary=await new FileRunStorage().Read(path.join(f.user,entry.id,'loop-engine/tasks',run.binding.taskId,run.binding.runId));summaries.push(summary);
      expect(summary.events.filter(e=>e.type==='run.started')).toHaveLength(1);
      if(mode==='failed-member'){expect(summary.status).not.toBe('completed');expect(summary.taskProgress?.delivery).toBeUndefined()}
      else{expect(summary.status).toBe('completed');expect(summary.toolReceipts?.find(r=>r.toolCallId==='goal-member-'+index+'-read')?.outcome).toBe('succeeded');expect(summary.taskProgress?.delivery?.summary).toContain(fact)}
    }
    expect(new Set(runs.map(r=>r.binding.runId)).size).toBe(runs.length);
    expect(thread[0].toolReceipts?.find(r=>r.toolCallId==='goal-call-first')?.outcome).toBe(mode==='failed-member'?'failed':'succeeded');
    if(mode==='forged-evidence')expect(thread[0].toolReceipts?.find(r=>r.toolCallId==='goal-check-forged')?.outcome).toBe('failed');
    expect(mainRequests).toHaveLength(mode==='forged-evidence'||mode==='replan'?3:2);
    expect(memberRequests).toHaveLength(mode==='failed-member'?2:mode==='replan'?10:5);
    const files=[...thread,...summaries].flatMap(r=>[path.join(f.user,entry.id,'loop-engine/tasks',r.task.taskId,r.runId,'events.jsonl'),r.sessionFile!]);
    const bytes=await Promise.all(files.map(file=>fs.readFile(file))),requestCount=mainRequests.length+memberRequests.length;
    await f.app.Open(entry.id,true);
    expect((await scopes()).current).toEqual(current);expect(await f.app.Workspace(entry.id).dispatchStore.Read()).toEqual(state);expect(await graph()).toEqual(snapshotGraph);
    expect(await Promise.all(files.map(file=>fs.readFile(file)))).toEqual(bytes);expect(mainRequests.length+memberRequests.length).toBe(requestCount);expect(errors).toEqual([]);
  }finally{release();await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},120000);
