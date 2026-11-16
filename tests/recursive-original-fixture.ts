import {expect,vi} from 'vitest';
import type {Application} from '../src/bridge/server/application';
import {AgentBusinessRuns} from '../src/logic/execution/storage/business-runs';
import {AgentCallScheduler} from '../src/logic/execution/assembly/agent-call-scheduler';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {seedMainToolContract} from './main-tool-contract-fixture';
import {mainToolContractFixture as data,type mainToolContractProvider} from './main-tool-contract-provider';

export type OriginalRecursiveMode='lost-registration'|'lost-result'|'before-call';
/** Lose only a real boundary response; source lookup must never replay the business operation. */
export async function prepareRecursiveOriginal(app:Application,project:string,provider:Awaited<ReturnType<typeof mainToolContractProvider>>,mode:OriginalRecursiveMode){
 const seed=await seedMainToolContract(app,project,provider),id=seed.entry.id;let submissions=0,registrations=0;
 const bind=AgentCallScheduler.prototype.Bind,startRun=AgentBusinessRuns.prototype.Start;
 vi.spyOn(AgentBusinessRuns.prototype,'Start').mockImplementation(async function(this:AgentBusinessRuns,...args:Parameters<typeof startRun>){
  const result=await startRun.apply(this,args);registrations++;if(mode==='lost-registration')throw Error('TEST_REGISTRATION_REPLY_LOST');return result;
 });
 vi.spyOn(AgentCallScheduler.prototype,'Bind').mockImplementation(function(this:AgentCallScheduler,...args:Parameters<typeof bind>){
  const result=bind.apply(this,args),call=result.capability.tools.call.bind(result.capability.tools);
  result.capability.tools.call=async(...input:Parameters<typeof call>)=>{
   if(input[0]!=='cbim_agent_call')return call(...input);
   submissions++;
   if(mode==='before-call')return {...jsonToolResult(input[0],{error:{code:'TEST_BEFORE_START',started:false}}),isError:true};
   const actual=await call(...input);return mode==='lost-result'?{...jsonToolResult(input[0],{error:{code:'TEST_RESULT_REPLY_LOST',started:true}}),isError:true}:actual;
  };return result;
 });
 try{
  provider.release();
  const started=await app.Dispatch('loop.chat',{id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}});
  await vi.waitFor(async()=>{if(provider.errors.length)return;expect((await app.Workspace(id).dispatchStore.Read()).scopes?.[0]?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
  expect(provider.errors).toEqual([]);expect(submissions).toBe(1);expect(registrations).toBe(mode==='before-call'?0:1);
  const state=await app.Workspace(id).dispatchStore.Read(),thread=await app.Execution(id).Thread(started.taskId);
  expect(state.graphs[0].tasks).toEqual([]);expect(state.agentBusinessRuns??[]).toHaveLength(mode==='before-call'?0:1);
  expect(provider.member).toHaveLength(mode==='lost-result'?5:0);expect(provider.main).toHaveLength(3);
  return {seed,started,state,thread,submissions,registrations,identity:{workspaceId:id,rootSessionId:started.taskId}};
 }finally{vi.restoreAllMocks()}
}
