import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../unittest/support/helpers';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../../../workspace/service/paths';
import {FileRunStorage} from '../../../execution/storage/run-storage';
import {AgentCallScheduler} from '../../../execution/assembly/agent-call-scheduler';
import {jsonToolResult} from '../../../tools/rules/results';
import {seedOwnerExecution,ownerExecutionData as data,ownerExecutionRecords} from '../../../team/service/unittest/support/owner-execution-fixture';
import {ownerExecutionProvider,type OwnerExecutionMode} from '../../../team/runtime/unittest/support/owner-execution-provider';
import {moduleOwnershipChange,commitModuleOwnership} from '../../../workspace/service/unittest/support/module-ownership-fixture';

it.each(['complete','owner-before-claim','profile-before-claim','profile-after-claim','stop','bad-wire'] as OwnerExecutionMode[])('real recursive Pi uses each registered owner and freezes its actual model (%s)',async mode=>{
 const f=await fixture(),provider=await ownerExecutionProvider(mode,true);let app=f.app,workspaceId='',lostReplies=0;
 try{
  const seeded=await seedOwnerExecution(app,f.a,provider.urls);workspaceId=seeded.entry.id;provider.bind(seeded.team.input.agentId,seeded.modules);
  // Lose only the returned acknowledgement after the real child has completed. Rechecking uses its original call, never another dispatch.
  if(mode==='bad-wire'){
   const bind=AgentCallScheduler.prototype.Bind;
   vi.spyOn(AgentCallScheduler.prototype,'Bind').mockImplementation(function(this:AgentCallScheduler,...args:Parameters<typeof bind>){
    const binding=bind.apply(this,args),call=binding.capability.tools.call.bind(binding.capability.tools);
    binding.capability.tools.call=async(...input:Parameters<typeof call>)=>{
     const result=await call(...input);
     if(input[0]==='cbim_agent_call'&&input[3]==='execution-call-0'){lostReplies++;return {...jsonToolResult(input[0],{error:{code:'OWNER_REPLY_LOST',message:'Actual child completed; response lost'}}),isError:true}}
     return result;
    };return binding;
   });
  }
  const started=await app.Dispatch('loop.chat',{id:workspaceId,message:data.goal,options:seeded.mainOptions}),identity={workspaceId,rootSessionId:started.taskId};
  const records=()=>ownerExecutionRecords(f.user,workspaceId),state=()=>app.Workspace(workspaceId).dispatchStore.Read();
  const until=(check:()=>void|Promise<void>)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);await check()},{timeout:60000,interval:30});
  await until(()=>expect(provider.state.held).toBe(true));
  expect(provider.members.map(items=>items.length)).toEqual([0,0]);expect((await state()).agentBusinessRuns??[]).toEqual([]);
  expect((await state()).graphs[0].tasks).toEqual([]);
  if(mode==='owner-before-claim'){
   const b=seeded.positions[1].member;
   await commitModuleOwnership(app,workspaceId,await moduleOwnershipChange(app,workspaceId,seeded.modules[0],{memberId:b.memberId,expectedRevision:b.revision},'调用尚未开始，将模块明确交给 B；旧 A 不得继续执行'));
  }
  const updateProfile=()=>{const p=seeded.profiles[1];return app.models.Save({id:p.id,profile:{...p.definition,models:p.definition.models.map(m=>({...m,maxTokens:2048}))}})};
  if(mode==='profile-before-claim')await updateProfile();
  if(mode==='stop')await app.Dispatch('loop.stop',{id:workspaceId,taskId:started.taskId});
  provider.releaseMain();
  if(mode==='profile-after-claim'){
   await until(()=>expect(provider.members[0]).toHaveLength(1));
   expect((await state()).agentBusinessRuns?.[0].status).toBe('active');
   await updateProfile();provider.releaseMembers();
  }
  await until(async()=>{expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await records(),persisted=await state(),business=persisted.agentBusinessRuns??[],successful=['complete','profile-after-claim','bad-wire'].includes(mode);
  // A handled rejected tool is not an accepted business result. The ordinary root conversation may end after explaining it.
  expect(saved.scopes[0].outcome).toBe(mode==='stop'?'cancelled':'completed');expect(saved.scopes[0].goal?.review).toBeUndefined();
  expect(persisted.graphs[0].tasks).toEqual([]);expect(saved.runs).toEqual([]);
  expect(business).toHaveLength(successful?2:0);expect(provider.members.map(items=>items.length)).toEqual(successful?[5,5]:[0,0]);
  expect(provider.main).toHaveLength(mode==='stop'?2:successful?mode==='bad-wire'?5:4:3);
  const thread=await app.Execution(workspaceId).Thread(started.taskId);expect(thread).toHaveLength(1);expect(thread[0].runId).toBe(started.runId);
  const storage=new FileRunStorage(),summaries=[thread[0]];
  for(const [index,run] of business.entries()){
   expect(run.status).toBe('closed');expect(run.parent).toMatchObject({callerRunId:started.runId,toolCallId:'execution-call-'+index});
   expect(run.prepared.memberContext?.binding).toMatchObject({memberId:seeded.positions[index].member.memberId,model:{profileId:seeded.profiles[index+1].id,modelId:data.models[index]}});
   expect(run.prepared.memberContext?.adaptation.instructions).toBe(data.adaptations[index]);
   const child=await storage.Read(path.join(f.user,workspaceId,'loop-engine/tasks',run.binding.taskId,run.binding.runId));summaries.push(child);
   expect(child.memberBinding).toEqual(run.binding);expect(child.status).toBe('completed');expect(child.unresolvedTools).toEqual([]);
   expect(child.toolReceipts?.find(r=>r.toolCallId==='execution-worker-'+index+'-read')?.outcome).toBe('succeeded');
   expect(child.taskProgress?.delivery?.summary).toContain(data.facts[index]);
   for(const request of provider.members[index]){
    const payload=request as unknown as {model:string;max_tokens?:number;max_completion_tokens?:number};
    expect(payload.model).toBe(data.models[index]);expect(payload.max_tokens??payload.max_completion_tokens).toBe(4096);
   }
  }
  const receipt=thread[0].toolReceipts?.find(r=>r.toolCallId==='execution-call-0');
  if(mode==='stop')expect(receipt).toBeUndefined();
  else expect(receipt?.outcome).toBe(successful&&mode!=='bad-wire'?'succeeded':'failed');
  if(mode==='bad-wire'){expect(lostReplies).toBe(1);expect(thread[0].toolReceipts?.find(r=>r.toolCallId==='execution-call-check')?.outcome).toBe('succeeded')}
  const files=summaries.flatMap(s=>[path.join(f.user,workspaceId,'loop-engine/tasks',s.task.taskId,s.runId,'events.jsonl'),s.sessionFile!]);
  const bytes=await Promise.all(files.map(file=>fs.readFile(file))),sequence=[...provider.sequence];
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await records()).toEqual(saved);expect(await state()).toEqual(persisted);expect(provider.sequence).toEqual(sequence);
  expect(await Promise.all(files.map(file=>fs.readFile(file)))).toEqual(bytes);expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-owner-'+mode+'.json',JSON.stringify({mode,identity,business,httpRequests:provider.httpRequests,errors:provider.errors,restartWithoutReplay:true},null,2));
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-owner-'+mode+'-failure.json',JSON.stringify({error:String(error),errors:provider.errors,state:provider.state,httpRequests:provider.httpRequests,records:workspaceId?await ownerExecutionRecords(f.user,workspaceId):undefined},null,2));throw error}
 finally{provider.releaseMain();provider.releaseMembers();vi.restoreAllMocks();await app.Shutdown();await f.cleanup();await provider.close()}
},120000);
