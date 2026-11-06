import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
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
it('automatically executes a model dispatch and returns its candidate to the same main conversation without replay after reopening',async()=>{
  const f=await fixture();
  const mainGoal='COLLAB_MAIN: 请让团队成员核实模块内的实际文件，并将结果告诉我';
  const memberGoal='COLLAB_MEMBER: 读取协作输入文件并报告实际内容';
  const businessFact='COLLAB_FILE_FACT_7c4d52';
  const candidate='成员已核实实际文件内容为 '+businessFact;
  const acceptance=['实际读取 collaboration-input.txt 并提供读取回执'];
  const requests:ProviderRequest[]=[],mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[];
  const transportErrors:unknown[]=[];
  let agentId='',moduleId='';
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
        if(turn===0)tool('main-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:memberGoal,acceptance:acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
        else if(turn===1)reply('已登记成员任务，等待返回，尚未宣称完成。');
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
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    agentId=team.input.agentId;moduleId=team.input.moduleId;
    const snapshot=await workspace.snapshot(),modulePath=moduleId+'/module.json';
    const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'collaboration-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'collaboration-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    await fs.writeFile(path.join(f.a,'collaboration-input.txt'),businessFact);

    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    const thread=()=>f.app.execution(entry.id).thread(started.taskId);
    let history:RunSummary[]=[];
    await vi.waitFor(async()=>{
      history=await thread();
      expect(history).toHaveLength(2);
      expect(history.every(run=>run.status==='completed')).toBe(true);
    },{timeout:30000,interval:50});

    const snapshotGraph=await graph();
    expect(snapshotGraph.tasks).toHaveLength(1);
    const task=snapshotGraph.tasks[0];
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
    expect(member.runs[0]).toMatchObject({permission:'read',status:'completed',binding:{rootSessionId:started.taskId}});
    expect(await f.app.dispatch('dispatch.messages',{...identity,agentSessionId:snapshotGraph.root.agent.agentSessionId})).toEqual([]);
    await expect(fs.readFile(path.join(f.a,'collaboration-forbidden.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readFile(path.join(f.a,'collaboration-input.txt'),'utf8')).toBe(businessFact);
    expect(mainRequests).toHaveLength(3);
    expect(memberRequests).toHaveLength(6);
    expect(memberRequests.every(body=>body.tools?.every(tool=>!tool.function.name.startsWith('cbim_dispatch_')&&tool.function.name!=='write'))).toBe(true);
    expect(JSON.stringify(mainRequests[2].messages)).toContain(candidate);
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
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},90000);

it.each(['deliver','stop'] as const)('keeps ask approvals and queued user input independent during automatic collaboration (%s)',async(outcome)=>{
  const f=await fixture();
  const mainGoal='ASK_COLLAB_MAIN: 委派成员写入并验证成果';
  const memberGoal='ASK_COLLAB_MEMBER: 写入成果文件并读取验证';
  const businessFact='ASK_MEMBER_FACT_f291ce';
  const candidate='成员已写入并读取 '+businessFact;
  const acceptance=['ask-member-output.txt 实际内容与指定内容一致'];
  const queuedMessage='QUEUED_USER_AFTER_COLLAB: 请保留这条原始要求，在团队结果之后回复';
  const followupMessage='RESUMED_USER_NEW_GOAL: 这是独立的下一轮目标，请说明当前交付限制';
  const requests:ProviderRequest[]=[],mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[];
  const transportErrors:unknown[]=[];
  let agentId='',moduleId='';
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest;requests.push(body);
      const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
      const history=isMain?mainRequests:memberRequests,turn=history.length;history.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'ask-collaboration-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content},null);emit({},'stop')};
      if(isMain){
        if(turn===0)tool('main-ask-write','write',{path:'ask-main-note.txt',content:'main run approved only'});
        else if(turn===1)tool('main-ask-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:memberGoal,acceptance:acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
        else if(turn===2)reply('已派发成员任务，本轮让出执行占用。');
        else if(turn===3)reply(JSON.stringify(body.messages).includes(candidate)?'主 Agent 已处理成员写入结果：'+businessFact:'缺少成员候选。');
        else{
          const input=JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content);
          reply(input.includes(followupMessage)?'已收到独立续聊要求：'+followupMessage:input.includes(queuedMessage)?'已收到原始排队要求：'+queuedMessage:'没有收到原始用户要求。');
        }
      }else{
        if(turn===0)tool('ask-member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'执行主会话委派',acceptance,steps:[{id:'verify',title:'写入后核实真实文件',owner:'开发者'}]});
        else if(turn===1)tool('ask-member-write','write',{path:'ask-member-output.txt',content:businessFact});
        else if(turn===2)tool('ask-member-read','read',{path:'ask-member-output.txt'});
        else if(turn===3)tool('ask-member-inspect','cbim_task_inspect',{});
        else if(turn===4)tool('ask-member-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['ask-member-read']});
        else if(turn===5)tool('ask-member-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:candidate,limitations:['尚未人工验收']});
        else reply('已提交写入与读取候选。');
      }
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local ask fixture failed')}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Local ask fixture did not bind');
    await f.app.models.save({profile:{name:'Local ask collaboration fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'ask-collaboration-fixture',models:[{id:'ask-collaboration-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    agentId=team.input.agentId;moduleId=team.input.moduleId;
    const snapshot=await workspace.snapshot(),modulePath=moduleId+'/module.json';
    const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'ask-collaboration-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'ask-collaboration-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));

    const scopesOpened=vi.spyOn(f.app.memberDispatch(entry.id),'openScope'),scopesClosed=vi.spyOn(f.app.memberDispatch(entry.id),'closeScope');
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'ask',turnTimeoutMs:20000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId};
    const graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    const thread=()=>f.app.execution(entry.id).thread(started.taskId);
    // Verify the durable goals, not only calls to the coordinator's open/close methods.
    const scopes=async()=>{
      // Read complete committed lines without opening a second recovering writer over the live store.
      const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
      for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
        const {body}=JSON.parse(line);expect(body.workspaceId).toBe(entry.id);
        for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope);
      }
      return [...found.values()];
    };
    let taskId='';
    await vi.waitFor(async()=>{const value=await graph();expect(value.tasks).toHaveLength(1);taskId=value.tasks[0].taskId;expect(value.tasks[0].status).toBe('running')},{timeout:15000,interval:30});
    const memberIdentity={...identity,taskId};
    let memberApprovals:ChatApproval[]=[];
    await vi.waitFor(async()=>{memberApprovals=await f.app.dispatch('dispatch.approvals',memberIdentity);expect(memberApprovals).toHaveLength(1)},{timeout:15000,interval:30});
    expect(memberApprovals[0].name).toBe('write');
    // The coordinator cannot write even if the model invents that tool; only the executor can ask for business permission.
    await expect(fs.readFile(path.join(f.a,'ask-main-note.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    expect(mainRequests.every(body=>body.tools?.every(tool=>!['write','edit','bash'].includes(tool.function.name)))).toBe(true);
    const beforeQueue=await thread();expect(beforeQueue).toHaveLength(1);expect(beforeQueue[0].status).toBe('completed');
    expect((await f.app.dispatch('dispatch.executionInspect',memberIdentity) as MemberExecutionView).runs[0]).toMatchObject({permission:'ask',status:'running'});
    await expect(fs.readFile(path.join(f.a,'ask-member-output.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    expect(await f.app.dispatch('loop.approvals',{id:entry.id,taskId:started.taskId})).toEqual([]);
    const originalScopes=await scopes();expect(originalScopes).toHaveLength(1);
    expect(originalScopes[0]).toMatchObject({...identity,status:'active',goal:{revision:1,input:{message:mainGoal,attachmentIds:[]}}});

    const queued=await f.app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:started.runId,message:queuedMessage,options:{permission:'execute',turnTimeoutMs:20000}});
    expect(queued).toMatchObject({taskId:started.taskId,runId:started.runId,queued:true,queueId:expect.any(String)});
    expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).toEqual([expect.objectContaining({id:queued.queueId,message:queuedMessage,status:'pending',options:expect.objectContaining({permission:'execute'})})]);
    expect(mainRequests).toHaveLength(3);
    expect(await f.app.dispatch('dispatch.approvals',memberIdentity)).toEqual(memberApprovals);
    expect(scopesOpened).toHaveBeenCalledTimes(1);expect(scopesClosed).not.toHaveBeenCalled();
    expect(await scopes()).toEqual(originalScopes); // Waiting user input is not a new running goal yet.

    if(outcome==='stop'){
      const requestCount=requests.length;
      await f.app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
      await vi.waitFor(async()=>expect((await f.app.dispatch('dispatch.executionInspect',memberIdentity) as MemberExecutionView).task.status).toBe('cancelled'),{timeout:15000,interval:30});
      expect(scopesClosed).toHaveBeenCalledWith(identity,scopesOpened.mock.calls[0][1],'cancelled');
      await expect(f.app.dispatch('dispatch.approve',{...memberIdentity,approvalId:memberApprovals[0].id,allow:true,allowAll:true})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
      expect(await thread()).toHaveLength(1);
      expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).toEqual([expect.objectContaining({message:queuedMessage,status:'paused'})]);
      await expect(fs.readFile(path.join(f.a,'ask-member-output.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
      await f.app.open(entry.id,true);
      expect(await thread()).toHaveLength(1);
      const stoppedScopes=await scopes();expect(stoppedScopes).toHaveLength(1);
      expect(stoppedScopes[0]).toMatchObject({scopeId:originalScopes[0].scopeId,outcome:'cancelled',goal:originalScopes[0].goal});
      expect(requests).toHaveLength(requestCount);
      expect(transportErrors).toEqual([]);
      return;
    }

    await f.app.dispatch('dispatch.approve',{...memberIdentity,approvalId:memberApprovals[0].id,allow:true,allowAll:true});
    let history:RunSummary[]=[];
    await vi.waitFor(async()=>{history=await thread();expect(history).toHaveLength(3);expect(history.every(run=>run.status==='completed')).toBe(true)},{timeout:30000,interval:50});
    expect(await fs.readFile(path.join(f.a,'ask-member-output.txt'),'utf8')).toBe(businessFact);
    expect(history.map(run=>run.source?.kind)).toEqual([undefined,'member-results',undefined]);
    expect(history.map(run=>run.task.taskId)).toEqual([started.taskId,started.taskId,started.taskId]);
    expect(new Set(history.map(run=>run.sessionFile)).size).toBe(1);
    expect(JSON.stringify(history[1].events.filter(event=>event.type==='message'))).toContain('主 Agent 已处理成员写入结果：'+businessFact);
    expect(JSON.stringify(history[2].events.filter(event=>event.type==='message'))).toContain('已收到原始排队要求：'+queuedMessage);
    expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:started.taskId})).toEqual([]);
    expect(mainRequests).toHaveLength(5);expect(memberRequests).toHaveLength(7);
    expect(JSON.stringify(mainRequests[3].messages)).toContain(candidate);
    expect(JSON.stringify(mainRequests[3].messages)).not.toContain(queuedMessage);
    expect(JSON.stringify(mainRequests[4].messages.filter(message=>message.role==='user').at(-1)?.content)).toContain(queuedMessage);
    expect((await graph()).tasks[0]).toMatchObject({status:'result_ready',result:{summary:candidate,acceptance:'not_evaluated'}});
    await vi.waitFor(()=>expect(scopesClosed).toHaveBeenCalledTimes(2),{timeout:5000,interval:20});
    expect(scopesOpened).toHaveBeenCalledTimes(2);
    expect(scopesOpened.mock.calls[0][1]).not.toBe(scopesOpened.mock.calls[1][1]);
    expect((await graph()).tasks[0].scopeId).toBe(scopesOpened.mock.calls[0][1]);
    const closed=await Promise.all(scopesClosed.mock.results.map(result=>result.value));
    expect(closed.map(scope=>scope.outcome)).toEqual(['completed','completed']);
    const beforeFollowup=await scopes();expect(beforeFollowup).toHaveLength(2);
    expect(beforeFollowup[0]).toMatchObject({scopeId:originalScopes[0].scopeId,status:'closed',goal:originalScopes[0].goal});
    expect(beforeFollowup[1]).toMatchObject({...identity,status:'closed',goal:{revision:1,input:{message:queuedMessage,attachmentIds:[]}}});
    expect(history[1].source?.kind).toBe('member-results');
    expect(beforeFollowup.some(scope=>scope.goal?.input.message.includes(candidate))).toBe(false);

    const followup=await f.app.dispatch('loop.resume',{id:entry.id,taskId:started.taskId,runId:history[2].runId,message:followupMessage,options:{permission:'read',turnTimeoutMs:20000}});
    await vi.waitFor(async()=>{history=await thread();expect(history).toHaveLength(4);expect(history.every(run=>run.status==='completed')).toBe(true);expect((await scopes()).every(scope=>scope.status==='closed')).toBe(true)},{timeout:15000,interval:30});
    expect(history[3].runId).toBe(followup.runId);expect(history[3].events[0].data.message).toBe(followupMessage);
    expect(new Set(history.map(run=>run.sessionFile)).size).toBe(1);
    expect(history.every(run=>run.task.goal===mainGoal)).toBe(true); // Thread identity stays stable; scope goals carry the new inputs.
    const persisted=await scopes();expect(persisted).toHaveLength(3);
    expect(new Set(persisted.map(scope=>scope.scopeId)).size).toBe(3);
    expect(persisted.every(scope=>scope.rootSessionId===started.taskId)).toBe(true);
    expect(persisted.map(scope=>scope.goal?.input)).toEqual([mainGoal,queuedMessage,followupMessage].map(message=>({message,attachmentIds:[]})));
    expect(persisted.slice(0,2)).toEqual(beforeFollowup);
    expect(mainRequests).toHaveLength(6);expect(memberRequests).toHaveLength(7);
    const requestCount=requests.length;
    await f.app.open(entry.id,true);
    expect(await scopes()).toEqual(persisted);expect(await thread()).toHaveLength(4);
    expect(requests).toHaveLength(requestCount);
    expect(transportErrors).toEqual([]);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},90000);
