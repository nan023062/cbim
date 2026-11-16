import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {QuestionTools} from '../src/logic/tools/runtime/question-tools';
import type {QuestionInput} from '../src/logic/tools/rules/questions';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {mainToolContractFixture as data} from './main-tool-contract-provider';
import {seedMainToolContract,mainToolContractRecords,mainToolContractLogBytes} from './main-tool-contract-fixture';
import {memberToolContractProvider,memberQuestion,memberAnswer,type MemberToolFault} from './member-tool-contract-provider';

it.each(['help','checkpoint']as MemberToolFault[])('keeps original recursive question and effects after a corrupt answer output without replay (%s)',async mode=>{
 const f=await fixture(),provider=await memberToolContractProvider(mode);let app=f.app,consumed=0;
 try{
  const contract={version:1,beforeEffects:{requirePlan:true},artifactScope:{version:1,roots:[{path:data.file,kind:'file'}]},delivery:{requiredToolEvidence:[{id:'read-file',toolName:'read'}]}};
  const {entry}=await seedMainToolContract(app,f.a,provider,'# Original-call evidence\n\n```cbim-workflow\n'+JSON.stringify(contract)+'\n```\n');
  const original=QuestionTools.prototype.Call;
  vi.spyOn(QuestionTools.prototype,'Call').mockImplementation(async function(this:QuestionTools,...args:Parameters<typeof original>){
   const self=this as unknown as {request(input:QuestionInput,signal:AbortSignal):Promise<unknown>},request=self.request;
   // 实际父级答案先持久化并交给原等待，再只损坏工具包装层取得的返回值。
   self.request=async(input,signal)=>{const value=await request(input,signal);consumed++;return {...value as object,privateCorruptOutput:'private-corrupt-member-output'}};
   try{return await original.apply(this,args)}finally{self.request=request}
  });
  const started=await app.Dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:mode==='checkpoint'?'execute':'read',turnTimeoutMs:60000}});
  const identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>mainToolContractRecords(f.user,entry.id),graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity});
  await vi.waitFor(async()=>{if(provider.errors.length)return;expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:40000,interval:30});
  expect(provider.errors,JSON.stringify(provider.errors)).toEqual([]);expect(consumed).toBe(1);
  const saved=await records(),finished=await graph(),business=(await app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns!;
  expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(saved.scopes).toHaveLength(1);expect(business).toHaveLength(1);expect(business[0].status).toBe('closed');
  expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(mode==='help'?4:7);
  const b=business[0].binding,storage=new FileRunStorage(),dir=path.join(f.user,entry.id,'loop-engine/tasks',b.taskId,b.runId),child=await storage.Read(dir);
  const parent=await storage.Read(path.join(f.user,entry.id,'loop-engine/tasks',started.taskId,started.runId));
  const frames=parent.events.filter(e=>e.type==='tool.updated'&&e.data.id==='member-contract-call');
  expect(frames.filter(e=>e.data.agentCallState==='waiting')).toHaveLength(1);
  expect(frames.filter(e=>e.data.agentCallState==='running')).toEqual([expect.objectContaining({data:expect.objectContaining({questionId:'1',answer:{answers:[{question:memberQuestion,answer:memberAnswer}]}})})]);
  expect(child.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  expect(child.events[0].data.agentCall).toMatchObject({callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'member-contract-call',taskId:b.taskId,runId:b.runId});
  const bad=child.events.filter(e=>e.type==='tool.finished'&&e.data.id==='member-contract-stage');
  expect(bad).toHaveLength(1);expect(bad[0].data.isError).toBe(true);expect(JSON.stringify(bad)).toContain('TOOL_OUTPUT_INVALID');expect(JSON.stringify(bad)).not.toContain('private-corrupt-member-output');
  expect(child.events.filter(e=>e.type==='tool.finished'&&e.data.name==='read'&&!e.data.isError)).toHaveLength(1);
  expect(child.events.filter(e=>e.type==='tool.finished'&&e.data.name==='write'&&!e.data.isError)).toHaveLength(mode==='checkpoint'?1:0);
  expect(child.events.some(e=>e.type==='tool.allowed'&&e.data.name==='cbim_task_complete')).toBe(false);
  expect(provider.state.call.verification?.state).not.toBe('verified');expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
  if(mode==='checkpoint')expect(provider.state.baselineId).toEqual(expect.any(String));
  const sessionFile=child.events.find(e=>e.type==='session.bound')?.data.sessionFile as string;
  const nativeBytes=await fs.readFile(sessionFile,'utf8'),native=nativeBytes.trim().split('\n').map(line=>JSON.parse(line));
  expect(native.find(item=>item.message?.toolCallId==='member-contract-stage')?.message).toMatchObject({isError:true,content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]});
  const counts=[provider.main.length,provider.member.length],bytes=await mainToolContractLogBytes(f.user,entry.id),events=await fs.readFile(path.join(dir,'events.jsonl')),stat=await fs.stat(path.join(f.a,data.file));
  vi.restoreAllMocks();await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
  expect(await graph()).toEqual(finished);expect(await records()).toEqual(saved);expect((await app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns).toEqual(business);
  expect(await mainToolContractLogBytes(f.user,entry.id)).toEqual(bytes);expect(await fs.readFile(path.join(dir,'events.jsonl'))).toEqual(events);expect(await fs.readFile(sessionFile,'utf8')).toBe(nativeBytes);
  expect((await fs.stat(path.join(f.a,data.file))).mtimeMs).toBe(stat.mtimeMs);expect([provider.main.length,provider.member.length]).toEqual(counts);expect(provider.errors).toEqual([]);
 }finally{vi.restoreAllMocks();await app.Shutdown();await f.cleanup();await provider.close()}
},90000);
