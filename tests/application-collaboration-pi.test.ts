import {spawn,type ChildProcess} from 'node:child_process';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {jsonValidationLogBytes} from './json-validation-fixture';
import type {ChatApproval} from '../src/logic/tools/rules/policy/types';

type ProviderRequest={model:string;messages:{role:string;content:unknown;tool_call_id?:string}[];tools?:{function:{name:string}}[]};
const fact='COLLAB_FILE_FACT_7c4d52',candidate='Agent verified '+fact;
const mainGoal='COLLAB_MAIN: read the actual input through an Agent';
const memberGoal='COLLAB_MEMBER: read collaboration-input.txt and return evidence';
const acceptance=['Read collaboration-input.txt and provide real evidence'];
const queuedMessage='QUEUED_USER_AFTER_CALL: preserve this original user request';
const followupMessage='RESUMED_USER_NEW_GOAL: describe delivery limitations';

function result(body:ProviderRequest,id:string){
  const message=body.messages.filter(message=>message.role==='tool'&&message.tool_call_id===id).at(-1);
  expect(message,'actual tool result '+id).toBeTruthy();
  return JSON.parse(String(message!.content));
}
/** Real Pi transport only; parent/child are identified by actual root-only capability. */
async function provider(mode:string){
  const main:ProviderRequest[]=[],member:ProviderRequest[]=[],errors:string[]=[];
  let memberId='',moduleId='';
  const ask=mode==='deliver'||mode==='stop',restart=mode.startsWith('restart');
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest;
      const root=body.tools?.some(tool=>tool.function.name==='cbim_agent_result_review');
      const history=root?main:member,turn=history.length;history.push(body);
      expect(body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')).toBe(false);
      // Stop at actual transport boundaries, leaving original run and canonical storage untouched.
      if(restart&&((root&&turn===1)||(mode==='restart-pending'&&!root&&turn===5)))return;
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'agent-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content},null);emit({},'stop')};
      if(root){
        const offset=ask?1:0;
        if(ask&&turn===0)tool('main-write','write',{path:'ask-main-note.txt',content:'must be denied'});
        else if(turn===offset)tool('agent-call','cbim_agent_call',{agentId:memberId,message:memberGoal,business:{moduleIds:[moduleId],acceptance}});
        else if(turn===offset+1){
          expect(result(body,'agent-call')).toMatchObject({status:'completed',summary:expect.stringContaining(fact),verification:{state:'verified',acceptance:'not_evaluated'}});
          tool('check-first','cbim_agent_result_check',{callId:mode==='repair'?'unknown-call':'agent-call'});
        }else if(mode==='repair'&&turn===2){
          expect(result(body,'check-first')).toHaveProperty('error');
          tool('check-repaired','cbim_agent_result_check',{callId:'agent-call'});
        }else{
          const input=JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content);
          if(input.includes(followupMessage))reply(followupMessage);
          else if(input.includes(queuedMessage))reply(queuedMessage);
          else{
            expect(result(body,mode==='repair'?'check-repaired':'check-first')).toMatchObject({state:'verified'});
            reply('Root received '+fact+'; human acceptance not evaluated');
          }
        }
      }else if(ask){
        if(turn===0)tool('member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'execute requested work',acceptance,steps:[{id:'verify',title:'write then read',owner:'Agent'}]});
        else if(turn===1)tool('member-write','write',{path:'ask-member-output.txt',content:fact});
        else if(turn===2)tool('member-read','read',{path:'ask-member-output.txt'});
        else if(turn===3)tool('member-inspect','cbim_task_inspect',{});
        else if(turn===4)tool('member-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['member-read']});
        else if(turn===5)tool('member-delivery','cbim_delivery_prepare',{expectedVersion:3,summary:candidate,limitations:['not human accepted']});
        else {expect(JSON.stringify(body.messages)).toContain(fact);reply(candidate)}
      }else{
        if(turn===0)tool(restart?'member-write':'member-forbidden-write','write',{path:restart?'collaboration-output.txt':'collaboration-forbidden.txt',content:fact});
        else if(turn===1)tool('member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'verify actual input',acceptance,steps:[{id:'verify',title:'read real input',owner:'Agent'}]});
        else if(turn===2)tool('member-read','read',{path:'collaboration-input.txt'});
        else if(turn===3)tool('member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['member-read']});
        else if(turn===4)tool('member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:candidate,limitations:['not human accepted']});
        else {expect(JSON.stringify(body.messages)).toContain(fact);reply(candidate)}
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('provider not bound');
  return {url:'http://127.0.0.1:'+address.port+'/v1',main,member,errors,
    bind:(id:string,module:string)=>{memberId=id;moduleId=module},
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
async function setup(f:Awaited<ReturnType<typeof fixture>>,p:Awaited<ReturnType<typeof provider>>){
  await f.app.models.Save({profile:{name:'Agent return fixture',api:'openai-completions',baseUrl:p.url,auth:'none',defaultModel:'return-fixture',models:[{id:'return-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json';
  const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'agent-return-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.Commit(request(snapshot,[{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'Owner',team:'.cbim/team'}]})},{path:modulePath,text:JSON.stringify(definition)}]));
  const owner=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await f.app.models.List()).selectedId!,modelId:'return-fixture'});
  p.bind(owner.selection.memberId,team.input.moduleId);
  await fs.writeFile(path.join(f.a,'collaboration-input.txt'),fact);
  return entry;
}
async function childRun(user:string,id:string,started:{taskId:string;runId:string}){
  const base=path.join(user,id,'loop-engine','tasks'),storage=new FileRunStorage();
  const root=await storage.Read(path.join(base,started.taskId,started.runId));
  const ref=root.events.find(event=>event.type==='tool.updated'&&event.data.agentCall)?.data.agentCall as {taskId:string;runId:string;callerTaskId:string;callerRunId:string};
  expect(ref).toMatchObject({callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'agent-call'});
  return {root,ref,child:await storage.Read(path.join(base,ref.taskId,ref.runId))};
}
async function until(p:Awaited<ReturnType<typeof provider>>,check:()=>Promise<void>|void){
  await vi.waitFor(async()=>{expect(p.errors).toEqual([]);await check()},{timeout:30000,interval:40});
}

/** Kill only the host created by this fixture and its owned engine descendants. */
async function crash(child:ChildProcess|undefined){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  if(process.platform==='win32'){
    await new Promise<void>((resolve,reject)=>{
      const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',reject);killer.once('exit',code=>code===0?resolve():reject(Error('Test process tree termination failed: '+code)));
    });
  }else child.kill('SIGKILL');
  await exited;
}

it.each(['normal','repair','restart','restart-corrupt','restart-pending','restart-stopped','restart-model'] as const)('returns Agent results within the original call and never replays on reopen (%s)',async mode=>{
  const f=await fixture(),p=await provider(mode);let processChild:ChildProcess|undefined;
  try{
    const entry=await setup(f,p);let started!:{taskId:string;runId:string};
    const restarting=mode.startsWith('restart');
    if(restarting){
      await f.app.Shutdown();const marker=path.join(f.temp,'ready.json');
      processChild=spawn(process.execPath,['--import','tsx','tests/automatic-return-crash-host.ts',f.user,entry.id,mainGoal,marker,mode],{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let stderr='';processChild.stderr!.on('data',chunk=>{stderr+=chunk});
      const exited=new Promise(resolve=>processChild!.once('exit',resolve));
      await until(p,async()=>{if(processChild!.exitCode!==null)throw Error(stderr);started=JSON.parse(await fs.readFile(marker,'utf8'))});
      await until(p,()=>{expect(p.member).toHaveLength(6);expect(p.main).toHaveLength(mode==='restart-pending'?1:2)});
      const before=await childRun(f.user,entry.id,started);
      if(mode==='restart-pending')expect(before.child.events.some(event=>['run.settled','run.interrupted'].includes(event.type))).toBe(false);else expect(before.child.status).toBe('completed');
      expect(await fs.readFile(path.join(f.a,'collaboration-output.txt'),'utf8')).toBe(fact);
      if(mode==='restart-stopped'){
        await fs.writeFile(marker+'.stop','stop');
        await until(p,async()=>{await fs.access(marker+'.stopped')});
      }
      await crash(processChild);await exited;
      if(mode==='restart-corrupt')await fs.appendFile(path.join(f.user,entry.id,'loop-engine','tasks',started.taskId,started.runId,'events.jsonl'),'{');
      const counts=[p.main.length,p.member.length],stat=await fs.stat(path.join(f.a,'collaboration-output.txt'));
      f.app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));
      await f.app.Init({restore:false});
      if(mode==='restart-model'){
        const {id,hasKey,...profile}=(await f.app.models.List()).profiles[0];
        await f.app.models.Save({id,profile:{...profile,models:profile.models.map(model=>({...model,maxTokens:4096}))}});
      }
      await f.app.Open(entry.id);
      const restored=await childRun(f.user,entry.id,started);
      expect(restored.root.status).toBe(mode==='restart-stopped'?'cancelled':'interrupted');
      expect(restored.child.status).toBe(mode==='restart-pending'?'interrupted':'completed');
      expect([p.main.length,p.member.length]).toEqual(counts);
      const bytes=await jsonValidationLogBytes(f.user,entry.id);
      await f.app.Open(entry.id,true);
      expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);
      expect([p.main.length,p.member.length]).toEqual(counts);
      expect((await fs.stat(path.join(f.a,'collaboration-output.txt'))).mtimeMs).toBe(stat.mtimeMs);
    }else{
      started=await f.app.Dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:60000}});
      await until(p,async()=>{const history=await f.app.Execution(entry.id).Thread(started.taskId);expect(history).toHaveLength(1);expect(history[0].status).toBe('completed')});
      const {root,child}=await childRun(f.user,entry.id,started);
      expect(child.status).toBe('completed');
      expect(child.taskProgress?.delivery).toMatchObject({summary:candidate});expect(child.taskProgress?.steps[0]).toMatchObject({evidence:['member-read'],state:'reported_done'});expect(child.events.find(event=>event.type==='tool.finished'&&event.data.id==='member-read')?.data.receipt).toMatchObject({outcome:'succeeded'});
      expect(root.acceptance).toBe('not_evaluated');
      expect(JSON.stringify(root.events.filter(event=>event.type==='message'))).toContain('Root received '+fact);
      expect(p.main).toHaveLength(mode==='repair'?4:3);expect(p.member).toHaveLength(6);
      expect(p.member.every(body=>!body.tools?.some(tool=>tool.function.name==='write'))).toBe(true);
      await expect(fs.readFile(path.join(f.a,'collaboration-forbidden.txt'))).rejects.toMatchObject({code:'ENOENT'});
      const counts=[p.main.length,p.member.length],bytes=await jsonValidationLogBytes(f.user,entry.id);
      await f.app.Dispatch('loop.stop',{id:entry.id,taskId:started.taskId});
      await f.app.Open(entry.id,true);
      expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);
      expect([p.main.length,p.member.length]).toEqual(counts);
    }
    expect((await f.app.Dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:started.taskId}})).tasks).toEqual([]);
    expect(await fs.readFile(path.join(f.a,'collaboration-input.txt'),'utf8')).toBe(fact);
    expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect(p.errors).toEqual([]);
  }finally{await crash(processChild);await f.app.Shutdown();await f.cleanup();await p.close()}
},90000);

it.each(['deliver','stop'] as const)('keeps approval identity and queued user input separate from Agent results (%s)',async outcome=>{
  const f=await fixture(),p=await provider(outcome);
  try{
    const entry=await setup(f,p),started=await f.app.Dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'ask',turnTimeoutMs:60000}});
    const input={id:entry.id,taskId:started.taskId},thread=()=>f.app.Execution(entry.id).Thread(started.taskId);
    let approvals:ChatApproval[]=[];
    await until(p,async()=>{approvals=await f.app.Dispatch('loop.approvals',input);expect(approvals).toHaveLength(1)});
    const mainApproval=approvals[0];expect(mainApproval.name).toBe('write');
    await f.app.Dispatch('loop.approve',{...input,approvalId:mainApproval.id,allow:false});
    await until(p,async()=>{approvals=await f.app.Dispatch('loop.approvals',input);expect(approvals).toHaveLength(1);expect(approvals[0].id).not.toBe(mainApproval.id)});
    const childApproval=approvals[0],running=await childRun(f.user,entry.id,started);
    expect(childApproval.name).toBe('write');expect((await thread())[0].status).toBe('running');expect(running.child.events.some(event=>['run.settled','run.interrupted'].includes(event.type))).toBe(false);
    await expect(f.app.Dispatch('loop.approve',{...input,approvalId:mainApproval.id,allow:true})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
    await expect(fs.readFile(path.join(f.a,'ask-main-note.txt'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(fs.readFile(path.join(f.a,'ask-member-output.txt'))).rejects.toMatchObject({code:'ENOENT'});
    const queued=await f.app.Dispatch('loop.resume',{...input,runId:started.runId,message:queuedMessage,options:{permission:'execute',turnTimeoutMs:60000}});
    expect(queued).toMatchObject({taskId:started.taskId,runId:started.runId,queued:true});
    expect(await f.app.Dispatch('loop.queue',input)).toEqual([expect.objectContaining({id:queued.queueId,message:queuedMessage,status:'pending'})]);
    expect(await f.app.Dispatch('loop.approvals',input)).toEqual([childApproval]);expect(p.main).toHaveLength(2);
    if(outcome==='stop'){
      const counts=[p.main.length,p.member.length];
      await f.app.Dispatch('loop.stop',input);
      await until(p,()=>expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0));
      const stopped=await childRun(f.user,entry.id,started);
      expect(stopped.root.status).toBe('cancelled');expect(stopped.child.status).toBe('cancelled');
      await expect(f.app.Dispatch('loop.approve',{...input,approvalId:childApproval.id,allow:true})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
      expect(await f.app.Dispatch('loop.queue',input)).toEqual([expect.objectContaining({message:queuedMessage,status:'paused'})]);
      await expect(fs.readFile(path.join(f.a,'ask-member-output.txt'))).rejects.toMatchObject({code:'ENOENT'});
      await f.app.Open(entry.id,true);expect(await thread()).toHaveLength(1);
      expect([p.main.length,p.member.length]).toEqual(counts);
    }else{
      await f.app.Dispatch('loop.approve',{...input,approvalId:childApproval.id,allow:true});
      await until(p,async()=>{const runs=await thread();expect(runs).toHaveLength(2);expect(runs.every(run=>run.status==='completed')).toBe(true)});
      let runs=await thread();expect(new Set(runs.map(run=>run.sessionFile)).size).toBe(1);
      expect(JSON.stringify(runs[0].events.filter(event=>event.type==='message'))).toContain('Root received '+fact);
      expect(runs[1].events[0].data.message).toBe(queuedMessage);
      expect(await fs.readFile(path.join(f.a,'ask-member-output.txt'),'utf8')).toBe(fact);
      expect(await f.app.Dispatch('loop.queue',input)).toEqual([]);
      expect(p.main).toHaveLength(5);expect(p.member).toHaveLength(7);
      expect(JSON.stringify(p.main[2].messages)).not.toContain(queuedMessage);
      const followup=await f.app.Dispatch('loop.resume',{...input,runId:runs[1].runId,message:followupMessage,options:{permission:'read',turnTimeoutMs:60000}});
      await until(p,async()=>{runs=await thread();expect(runs).toHaveLength(3);expect(runs.every(run=>run.status==='completed')).toBe(true)});
      expect(runs[2].runId).toBe(followup.runId);expect(runs[2].events[0].data.message).toBe(followupMessage);
      expect(runs.every(run=>run.task.goal===mainGoal)).toBe(true);
      expect(new Set(runs.map(run=>run.sessionFile)).size).toBe(1);
      expect(p.main).toHaveLength(6);expect(p.member).toHaveLength(7);
      const bytes=await jsonValidationLogBytes(f.user,entry.id);
      await f.app.Open(entry.id,true);
      expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);expect(p.main).toHaveLength(6);
    }
    expect((await f.app.Dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:started.taskId}})).tasks).toEqual([]);
    expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect(p.errors).toEqual([]);
  }finally{await f.cleanup();await p.close()}
},90000);
