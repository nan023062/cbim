import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {goalCompleteArguments,goalPlanArguments} from './goal-provider-fixture';
import type {RunSummary} from '../src/backend/core/brain/types';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {MemberExecutionView} from '../src/backend/core/tasks/member-commands';
import type {ChatApproval} from '../src/backend/core/policy/types';

type ProviderRequest={
  model:string;
  messages:{role:string;content:unknown}[];
  tools?:{function:{name:string}}[];
};

/** Real Application, native Pi, dispatch persistence and continuation; only the provider uses deterministic localhost responses. */
it.each(['read','ask','execute'] as const)('automatic executor completes a real Pi cycle without owners or modules (%s)',async(permission)=>{
  const f=await fixture();
  const mainGoal='COLLAB_MAIN: 请让团队成员核实模块内的实际文件，并将结果告诉我';
  const memberGoal='COLLAB_MEMBER: 读取协作输入文件并报告实际内容';
  const businessFact='COLLAB_FILE_FACT_7c4d52';
  const candidate='成员已核实实际文件内容为 '+businessFact;
  const acceptance=['实际读取 collaboration-input.txt 并提供读取回执'];
  const requests:ProviderRequest[]=[],mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[];
  const transportErrors:unknown[]=[];
  const agentId='cbim:executor',moduleId='cbim:project';let teamTurn=-1;
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest;requests.push(body);
      const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const history=isMain?mainRequests:memberRequests,turn=history.length;history.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'collaboration-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content},null);emit({},'stop')};
      if(isMain){
        if(teamTurn>=0){if(teamTurn++===0)tool('team-plan','cbim_goal_plan',goalPlanArguments({objective:mainGoal,agentId,moduleIds:[moduleId],acceptance}));else reply('团队模式缺少模块和负责人，等待人工确认。')}
        else if(turn===0)tool('main-goal-plan','cbim_goal_plan',goalPlanArguments({objective:mainGoal,agentId,moduleIds:[moduleId],acceptance}));
        else if(turn===1)tool('main-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:memberGoal,acceptance:acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
        else if(turn===2)reply('已登记成员任务，等待返回，尚未宣称完成。');
        else if(turn===3)tool('main-goal-inspect','cbim_goal_inspect',{});
        else if(turn===4)tool('main-goal-review','cbim_goal_review',goalCompleteArguments(body,'main-goal-inspect'));
        else reply(JSON.stringify(body.messages).includes(candidate)?'主 Agent 已收到成员结果：'+businessFact+'；候选尚未验收。':'主会话没有收到成员事实。');
      }else{
        // A model may hallucinate an unavailable native tool; readonly scope must still prevent the real write.
        if(turn===0)tool('member-forbidden-write','write',{path:'collaboration-forbidden.txt',content:'must-not-be-written'});
        else if(turn===1)tool('member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'处理主会话可靠派发的目标',acceptance,steps:[{id:'verify',title:'读取实际文件并核实内容',owner:'开发者'}]});
        else if(turn===2)tool('member-read','read',{path:'collaboration-input.txt'});
        else if(turn===3)tool('member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['member-read']});
        else if(turn===4)tool('member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:candidate,limitations:['尚未进行人工业务验收']});
        else reply('已准备交付候选，原发送方可核对读取证据。');
      }
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local collaboration fixture failed')}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Local collaboration fixture did not bind');
    await f.app.models.save({profile:{name:'Local collaboration fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'collaboration-fixture',models:[{id:'collaboration-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
    const initialKnowledge=(await workspace.snapshot()).revision;
    await fs.writeFile(path.join(f.a,'collaboration-input.txt'),businessFact);

    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission,collaborationMode:'auto',turnTimeoutMs:20000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    const thread=()=>f.app.execution(entry.id).thread(started.taskId);
    if(permission==='ask'){
      let approvals:ChatApproval[]=[],taskId='';
      await vi.waitFor(async()=>{taskId=(await graph()).tasks[0]?.taskId;expect(taskId).toBeTruthy();approvals=await f.app.dispatch('dispatch.approvals',{...identity,taskId});expect(approvals).toHaveLength(1)},{timeout:30000,interval:40});
      await expect(fs.readFile(path.join(f.a,'collaboration-forbidden.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
      await f.app.memberExecution(entry.id).answerApproval({...identity,taskId},approvals[0].id,true);
    }
    let history:RunSummary[]=[];
    await vi.waitFor(async()=>{
      history=await thread();
      expect(history).toHaveLength(2);
      expect(history.every(run=>run.status==='completed')).toBe(true);
    },{timeout:30000,interval:50});

    const snapshotGraph=await graph();
    expect(snapshotGraph.tasks).toHaveLength(1);
    const task=snapshotGraph.tasks[0];
    await vi.waitFor(async()=>expect(await f.app.memberDispatch(entry.id).goals.inspect(identity,task.scopeId!)).toMatchObject({status:'closed',outcome:'completed',goal:{revision:3,review:{decision:'complete'}}}),{timeout:5000,interval:30});
    expect(task).toMatchObject({goal:memberGoal,status:'result_ready',requester:snapshotGraph.root.agent,assignee:{agentId},modules:[{moduleId}],result:{summary:candidate,evidenceRefs:['member-read'],acceptance:'not_evaluated'}});
    expect(snapshotGraph.edges.filter(edge=>edge.kind==='dispatch')).toEqual([expect.objectContaining({fromNodeId:snapshotGraph.root.nodeId,toNodeId:task.nodeId})]);
    expect(history.map(run=>run.task.taskId)).toEqual([started.taskId,started.taskId]);
    expect(new Set(history.map(run=>run.runId)).size).toBe(2);
    expect(history[1].sessionFile).toBe(history[0].sessionFile);
    const resumed=history[1].events.find(event=>event.type==='run.started');
    expect(resumed?.data.source).toMatchObject({kind:'member-results',continuationId:expect.any(String)});
    expect(JSON.stringify(history[1].events.filter(event=>event.type==='message'))).toContain('主 Agent 已收到成员结果：'+businessFact);
    expect(history.every(run=>run.acceptance==='not_evaluated')).toBe(true);
    const member=await f.app.dispatch('dispatch.executionInspect',{...identity,taskId:task.taskId}) as MemberExecutionView;
    expect(member.runs).toHaveLength(1);
    expect(member.runs[0]).toMatchObject({permission,status:'completed',binding:{rootSessionId:started.taskId}});
    expect(await f.app.dispatch('dispatch.messages',{...identity,agentSessionId:snapshotGraph.root.agent.agentSessionId})).toEqual([]);
    if(permission==='read')await expect(fs.readFile(path.join(f.a,'collaboration-forbidden.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});else expect(await fs.readFile(path.join(f.a,'collaboration-forbidden.txt'),'utf8')).toBe('must-not-be-written');
    expect(await fs.readFile(path.join(f.a,'collaboration-input.txt'),'utf8')).toBe(businessFact);
    expect(mainRequests).toHaveLength(6);
    expect(memberRequests).toHaveLength(6);
    expect(memberRequests.every(body=>body.tools?.every(tool=>!tool.function.name.startsWith('cbim_dispatch_')&&(permission!=='read'||tool.function.name!=='write')))).toBe(true);
    expect(JSON.stringify(mainRequests[3].messages)).toContain(candidate);
    expect(JSON.stringify(memberRequests[3].messages)).toContain(businessFact);
    expect(transportErrors).toEqual([]);

    // Settled collaborations are not replayed by explicit stop or workspace reopen.
    const count=requests.length;
    await f.app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
    await f.app.open(entry.id,true);
    expect(await thread()).toHaveLength(2);
    expect((await graph()).tasks).toEqual(snapshotGraph.tasks);
    expect(await f.app.dispatch('dispatch.messages',{...identity,agentSessionId:snapshotGraph.root.agent.agentSessionId})).toEqual([]);
    expect(requests).toHaveLength(count);
    const stored=await f.app.workspace(entry.id).dispatchStore.read();expect(stored.workspaceMembers??[]).toEqual([]);expect(stored.moduleOwnerships??[]).toEqual([]);
    expect((await f.app.workspace(entry.id).snapshot()).revision).toBe(initialKnowledge);expect(task.fallbackBinding?.reason).toBe('no_modules');expect(task.ownerBinding).toBeUndefined();
    expect(JSON.stringify(mainRequests[2].messages)).toContain('fallbackBinding');expect(JSON.stringify(memberRequests[0].messages)).toContain('no_modules');
    teamTurn=0;const switched=await f.app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:history[1].runId,message:mainGoal,options:{permission,collaborationMode:'team',turnTimeoutMs:20000}});
    await vi.waitFor(async()=>expect((await thread()).find(r=>r.runId===switched.runId)?.status).toBe('completed'),{timeout:30000,interval:40});
    expect((await graph()).tasks).toHaveLength(1);expect(memberRequests).toHaveLength(6);
    const latest=(await thread()).at(-1)!;expect(JSON.stringify(latest.events)).toContain('ownerSelection');


  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},90000);

