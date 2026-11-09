import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {RunSummary} from '../src/backend/core/brain/types';
import {mainToolContractProvider,mainToolContractFixture as data,type MainToolContractMode} from './main-tool-contract-provider';
import {seedMainToolContract,mainToolContractRecords,mainToolContractLogBytes} from './main-tool-contract-fixture';

it.each(['complete','stop','bad-plan','bad-dispatch']as MainToolContractMode[])('validates real main tool outputs without replaying a committed action (%s)',async mode=>{
  const f=await fixture(),provider=await mainToolContractProvider(mode);let app=f.app;
  try{
    const seeded=await seedMainToolContract(app,f.a,provider),service=app.memberDispatch(seeded.entry.id),originalPlan=service.goals.plan.bind(service.goals),originalDispatch=service.dispatchTask.bind(service);
    // Explicit test-only corruption AFTER the original durable commit. Production validation and result encoding are untouched.
    const plans=vi.spyOn(service.goals,'plan').mockImplementation(async(...args)=>{const result=await originalPlan(...args);return mode==='bad-plan'?{...result,scopeId:undefined}as unknown as typeof result:result}),dispatches=vi.spyOn(service,'dispatchTask').mockImplementation(async(...args)=>{const result=await originalDispatch(...args);return mode==='bad-dispatch'?{...result,cursor:{...result.cursor,rootSessionId:'private-invalid-output-root'}}:result});
    const started=await app.dispatch('loop.chat',{id:seeded.entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:60000}}),identity={workspaceId:seeded.entry.id,rootSessionId:started.taskId},records=()=>mainToolContractRecords(f.user,seeded.entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}),fault=mode==='bad-plan'||mode==='bad-dispatch';
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);if(fault)expect(provider.state.faultConfirmed).toBe(true);else expect(provider.member).toHaveLength(1)},{timeout:30000,interval:30});
    expect(plans).toHaveBeenCalledTimes(1);expect(dispatches).toHaveBeenCalledTimes(mode==='bad-plan'?0:1);const before=await graph();expect(before.tasks).toHaveLength(mode==='bad-plan'?0:1);expect((await records()).scopes[0].goal).toMatchObject({revision:2,plan:{revision:2}});
    if(mode!=='complete')await app.dispatch('loop.stop',{id:seeded.entry.id,taskId:started.taskId});provider.release();
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const saved=await records(),finished=await graph(),thread=await app.execution(seeded.entry.id).thread(started.taskId),summary=thread[0]as RunSummary;expect(saved.scopes[0].outcome).toBe(mode==='complete'?'completed':'cancelled');expect(plans).toHaveBeenCalledTimes(1);expect(dispatches).toHaveBeenCalledTimes(mode==='bad-plan'?0:1);expect(finished.tasks).toHaveLength(mode==='bad-plan'?0:1);expect(summary.unresolvedTools).toEqual([]);
    if(fault){
      const id=mode==='bad-plan'?'contract-goal-plan':'contract-dispatch',receipt=summary.toolReceipts?.find(item=>item.toolCallId===id);expect(receipt).toMatchObject({outcome:'failed',effects:['maintenance']});const events=summary.events.filter(item=>item.type==='tool.finished'&&item.data.id===id);expect(events).toHaveLength(1);expect(events[0].data).toMatchObject({isError:true,result:{content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]}});expect(JSON.stringify(events)).not.toContain('private-invalid-output-root');expect(provider.member).toHaveLength(0);expect(saved.runs).toEqual([]);expect(provider.main).toHaveLength(mode==='bad-plan'?3:5);if(mode==='bad-dispatch'){expect(finished.tasks[0].taskId).toBe(before.tasks[0].taskId);expect(finished.tasks[0].runIds).toEqual([])}
      const native=(await fs.readFile(summary.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(native.find(item=>item.message?.toolCallId===id)?.message).toMatchObject({isError:true,content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]});
    }else{
      for(const id of ['contract-goal-plan','contract-dispatch','contract-dispatch-graph','contract-dispatch-node'])expect(summary.toolReceipts?.find(item=>item.toolCallId===id)).toMatchObject({outcome:'succeeded'});expect(finished.tasks[0].taskId).toBe(provider.state.receipt.taskId);expect(finished.tasks[0].assignee.agentInstanceId).not.toBe(finished.root.agent.agentInstanceId);expect(provider.main).toHaveLength(mode==='complete'?8:5);expect(provider.member).toHaveLength(mode==='complete'?5:1);
      if(mode==='complete'){expect(thread).toHaveLength(2);expect(saved.scopes[0].goal?.review?.decision).toBe('complete');expect(finished.tasks[0].result?.evidenceRefs).toEqual(['contract-member-read']);expect(finished.tasks[0].result?.acceptance).toBe('not_evaluated');for(const id of ['contract-goal-inspect','contract-goal-review'])expect(thread[1].toolReceipts?.find(item=>item.toolCallId===id)).toMatchObject({outcome:'succeeded'})}else expect(finished.tasks[0].result).toBeUndefined();
    }
    expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);const bytes=await mainToolContractLogBytes(f.user,seeded.entry.id),counts={main:provider.main.length,member:provider.member.length};vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await graph()).toEqual(finished);expect(await records()).toEqual(saved);expect(await mainToolContractLogBytes(f.user,seeded.entry.id)).toEqual(bytes);expect({main:provider.main.length,member:provider.member.length}).toEqual(counts);expect(provider.errors).toEqual([]);
  }finally{vi.restoreAllMocks();provider.release();await app.shutdown();await f.cleanup();await provider.close()}
},90000);
