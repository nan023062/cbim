import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {businessReplanProvider,businessReplanFixture as data} from './business-replan-provider';
import {prepareBusinessReplan} from './business-replan-fixture';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {ReplanRequest,ReplanReceipt,ReplanPreview} from '../src/backend/core/tasks/scope-replan';
import type {ConversationThreadView} from '../src/backend/core/brain/types';

it.each(['execute','ask','stop'] as const)('creates explicit independent business work after real read-only evidence (%s)',async mode=>{
  const f=await fixture(),provider=await businessReplanProvider({holdBusiness:true,holdOld:true});let app=f.app;
  try{
    const seeded=await prepareBusinessReplan(app,f.a,f.user,provider),{entry,identity,profileId,inspection,inspectionTask,oldTask,oldScope,originalGraph,corruption,marker,markerStat}=seeded;
    const scopes=()=>seeded.scopes(),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}),previewQuery={...identity,inspectionScopeId:inspection.scopeId},dispatchFile=path.join(f.user,entry.id,'dispatch','dispatch.jsonl');
    expect(provider.mainRequests).toHaveLength(12);expect(provider.memberRequests).toHaveLength(8);expect(inspection.recovery?.options.permission).toBe('read');
    const before=await fs.readFile(dispatchFile,'utf8'),preview=await app.dispatch('dispatch.replans.preview',previewQuery) as ReplanPreview;
    expect(preview.eligible,JSON.stringify(preview)).toBe(true);expect(preview.basis).toMatch(/^[a-f0-9]{64}$/);expect(preview.requiredModules.map(item=>item.moduleId)).toEqual(inspectionTask.modules.map(item=>item.moduleId));expect(preview.inheritedHuman).toEqual([]);
    expect((await app.dispatch('dispatch.replans.preview',previewQuery)).basis).toBe(preview.basis);expect(await fs.readFile(dispatchFile,'utf8')).toBe(before);expect(provider.mainRequests).toHaveLength(12);
    // A real inspection candidate loses eligibility when its canonical evidence tail is incomplete.
    const evidence=path.join(f.user,entry.id,'dispatch','runs','tasks',inspectionTask.taskId,inspectionTask.result!.runId,'events.jsonl'),evidenceBytes=await fs.readFile(evidence,'utf8');await fs.appendFile(evidence,'{"fixture_incomplete":');
    try{expect((await app.dispatch('dispatch.replans.preview',previewQuery)).eligible).toBe(false)}finally{await fs.writeFile(evidence,evidenceBytes)}
    const req:ReplanRequest={...identity,commandId:randomUUID(),source:{inspectionScopeId:inspection.scopeId,expectedBasis:preview.basis!},input:{message:data.businessGoal},options:{profileId,provider:'cbim-'+profileId,model:'report-fixture',permission:mode==='ask'?'ask':'execute',turnTimeoutMs:30000}},lookup={...identity,commandId:req.commandId};
    expect(await app.dispatch('loop.replanReceipt',lookup)).toBeUndefined();await expect(app.dispatch('loop.replanStart',{...req,source:{...req.source,expectedBasis:'0'.repeat(64)}})).rejects.toThrow();
    await expect(app.dispatch('loop.replanStart',{...req,options:{...req.options,permission:'read'}} as any)).rejects.toThrow();expect(await scopes()).toEqual([oldScope,inspection]);expect(provider.mainRequests).toHaveLength(12);
    const [receipt,duplicate]=await Promise.all([app.dispatch('loop.replanStart',req),app.dispatch('loop.replanStart',req)]) as ReplanReceipt[];expect(duplicate.replan).toEqual(receipt.replan);expect(receipt).toMatchObject({...identity,scopeId:req.commandId,replan:{replanId:req.commandId,operation:'business_replan',input:req.input,options:req.options,source:{inspectionScopeId:inspection.scopeId,expectedBasis:preview.basis}}});expect(JSON.stringify(receipt)).not.toContain('excludedRunIds');
    await vi.waitFor(()=>expect(provider.mainRequests).toHaveLength(13),{timeout:20000,interval:30});
    const business=(await scopes())[2];expect(business.scopeId).not.toBe(inspection.scopeId);expect(business.recovery).toBeUndefined();expect(business.replan!.context.nativeSessionId).not.toBe(inspection.recovery!.context.nativeSessionId);expect(business.goal?.input).toEqual({message:data.businessGoal,attachmentIds:[]});expect((await graph()).root.agent).toEqual(originalGraph.root.agent);expect((await scopes()).slice(0,2)).toEqual([oldScope,inspection]);
    expect((await app.dispatch('loop.replanStart',req)).replan).toEqual(receipt.replan);expect((await app.dispatch('loop.replanReceipt',lookup)).replan).toEqual(receipt.replan);expect(provider.mainRequests).toHaveLength(13);await expect(app.dispatch('loop.replanStart',{...req,input:{message:'changed'}})).rejects.toThrow();
    if(mode==='stop')await app.dispatch('loop.stop',{id:entry.id,taskId:identity.rootSessionId});
    else{
      provider.releaseBusiness();
      if(mode==='ask'){
        await vi.waitFor(async()=>{const task=(await graph()).tasks.find((item:any)=>item.scopeId===business.scopeId);expect(task).toBeDefined();const approvals=await app.dispatch('dispatch.approvals',{...identity,taskId:task.taskId});expect(approvals.some((item:any)=>item.name==='write')).toBe(true)},{timeout:20000,interval:30});
        await expect(fs.access(path.join(f.a,data.result))).rejects.toThrow();const task=(await graph()).tasks.find((item:any)=>item.scopeId===business.scopeId),approval=(await app.dispatch('dispatch.approvals',{...identity,taskId:task.taskId})).find((item:any)=>item.name==='write');await app.dispatch('dispatch.approve',{...identity,taskId:task.taskId,approvalId:approval.id,allow:true});
      }
    }
    await vi.waitFor(async()=>{expect((await scopes())[2].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const outcome=(await scopes())[2].outcome;
    if(outcome!==(mode==='stop'?'cancelled':'completed'))console.info('Business fixture diagnostics',JSON.stringify({mode,outcome,blocked:(await scopes())[2].goal?.blocked,errors:provider.errors,main:provider.mainRequests.length,member:provider.memberRequests.length,lastMemberTools:provider.memberRequests.at(-1)?.messages.filter(item=>item.role==='tool').map(item=>({id:item.tool_call_id,content:String(item.content).slice(0,1500)}))}));
    expect(outcome).toBe(mode==='stop'?'cancelled':'completed');
    if(mode==='stop'){expect(provider.mainRequests).toHaveLength(13);expect(provider.memberRequests).toHaveLength(8);await expect(fs.access(path.join(f.a,data.result))).rejects.toThrow()}
    else{
      expect(provider.mainRequests).toHaveLength(18);expect(provider.memberRequests).toHaveLength(15);expect(await fs.readFile(path.join(f.a,data.result),'utf8')).toBe(data.resultText);
      const task=(await graph()).tasks.find((item:any)=>item.scopeId===business.scopeId);expect(task.assignee.agentInstanceId).not.toBe(inspectionTask.assignee.agentInstanceId);expect(task.assignee.agentInstanceId).not.toBe(oldTask.assignee.agentInstanceId);expect(task.result.evidenceRefs).toEqual(expect.arrayContaining(['business-write','business-read']));
    }
    const view=await app.dispatch('loop.threadView',{id:entry.id,taskId:identity.rootSessionId}) as ConversationThreadView,first=view.runs.find(run=>run.runId===receipt.replan.runId)!;expect(first.events[0].data.freshMain).toEqual({nativeSessionId:business.replan!.context.nativeSessionId,excludedRunIds:business.replan!.context.excludedRunIds});expect(first.conversationBinding?.agentInstanceId).toBe(originalGraph.root.agent.agentInstanceId);expect(view.issues).toHaveLength(corruption.oldIds.length);
    const settled=await scopes(),counts=[provider.mainRequests.length,provider.memberRequests.length];expect(settled.slice(0,2)).toEqual([oldScope,inspection]);expect((await graph()).tasks.find((task:any)=>task.taskId===oldTask.taskId)).toEqual(oldTask);expect(await fs.readFile(marker,'utf8')).toBe(data.markerLine);expect((await fs.stat(marker)).mtimeMs).toBe(markerStat.mtimeMs);await corruption.unchanged();expect(provider.errors).toEqual([]);expect((await app.dispatch('loop.queue',{id:entry.id,taskId:identity.rootSessionId}))[0]).toMatchObject({message:data.queued,status:'paused'});
    expect((await app.dispatch('dispatch.replans.preview',previewQuery)).eligible,'较晚业务周期已经消费核实基线，旧核实不能换命令继续批准新业务').toBe(false);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await scopes()).toEqual(settled);expect((await app.dispatch('loop.replanReceipt',lookup)).scopeStatus).toBe('closed');expect((await app.dispatch('loop.replanStart',req)).replan).toEqual(receipt.replan);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(counts);await corruption.unchanged();
  }finally{provider.releaseBusiness();provider.releaseOld();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
