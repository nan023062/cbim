import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {executionReportProvider,reportFixture as data} from './execution-report-provider';
import {seedExecutionReport,reportFiles} from './execution-report-fixture';

it.each([false,true])('reads real Pi execution evidence without running or reconciling (successful=%s)',async(success)=>{
  const f=await fixture(),provider=await executionReportProvider({success,hold:true});
  try{
    const {entry}=await seedExecutionReport(f.app,f.a,provider);
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:data.mainGoal,options:{permission:success?'read':'execute',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(()=>expect(provider.memberRequests).toHaveLength(3),{timeout:30000,interval:30});
    const running=(await graph()).tasks[0];expect(running.status).toBe('running');expect(running.activeRunId).toBeTruthy();
    const query={...identity,taskId:running.taskId,runId:running.activeRunId!,limit:100};
    const inFlight=await f.app.dispatch('dispatch.executionReport',query);
    if(inFlight.execution==='unknown'){
      const diagnostic=await reportFiles(f.user,entry.id,query.taskId,query.runId),raw=await fs.readFile(diagnostic.log,'utf8');
      console.info('Native tool event order',raw.trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.type.startsWith('tool.')).map(event=>({type:event.type,seq:event.seq,id:event.data.id,name:event.data.name,receiptOutcome:event.data.receipt?.outcome})));
    }
    expect(inFlight.execution,JSON.stringify(inFlight)).toBe('in_flight');expect(inFlight.log.state).toBe('verified');expect(inFlight.tools.available).toBe(true);
    expect(inFlight.tools.items.find((tool:any)=>tool.toolCallId===(success?'report-business-read':'report-business-command'))?.status).toBe(success?'succeeded':'failed');
    if(!success)expect(await fs.readFile(path.join(f.a,data.marker),'utf8')).toBe(data.fact);
    expect(provider.memberRequests).toHaveLength(3);expect(provider.mainRequests).toHaveLength(3);
    provider.release();
    await vi.waitFor(async()=>{expect((await graph()).tasks[0].status).toBe(success?'result_ready':'failed');expect(provider.mainRequests).toHaveLength(6);expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const files=await reportFiles(f.user,entry.id,query.taskId,query.runId),before=await files.read(),graphBefore=await graph();
    const report=await f.app.dispatch('dispatch.executionReport',query);
    expect(report.execution).toBe('settled');expect(report.log.state).toBe('verified');expect(report.consistency).toBe('stable');
    expect(report.tools.items.find((tool:any)=>tool.toolCallId===(success?'report-business-read':'report-business-command'))?.status).toBe(success?'succeeded':'failed');
    const serialized=JSON.stringify(report);for(const secret of [f.a,f.user,data.fact,'writeFileSync','sessionFile','preparedKnowledge'])expect(serialized).not.toContain(secret);
    expect(report.candidate!==undefined).toBe(success);
    if(success)expect(report.candidate?.acceptance).toBe('not_evaluated');
    else expect(report.issues.some((issue:{code:string})=>issue.code==='TOOLS_FAILED_WITH_POSSIBLE_EFFECTS')).toBe(true);
    const unselected=await f.app.dispatch('dispatch.executionReport',{...identity,taskId:query.taskId});
    expect(unselected.log.state).toBe('not_selected');expect(unselected.identity.runId).toBeUndefined();expect(unselected.tools.available).toBe(false);expect(unselected.candidate).toBeUndefined();
    const first=await f.app.dispatch('dispatch.executionReport',{...query,limit:1});expect(first.tools.items).toHaveLength(1);
    const ids=first.tools.items.map((item:any)=>item.toolCallId);let cursor=first.tools.nextCursor;
    while(cursor){const page=await f.app.dispatch('dispatch.executionReport',{...query,limit:1,cursor});ids.push(...page.tools.items.map((item:any)=>item.toolCallId));cursor=page.tools.nextCursor}
    expect(ids).toEqual(report.tools.items.map((item:any)=>item.toolCallId));expect(new Set(ids).size).toBe(ids.length);
    await expect(f.app.dispatch('dispatch.executionReport',{...query,rootSessionId:randomUUID()})).rejects.toThrow();
    await expect(f.app.dispatch('dispatch.executionReport',{...query,taskId:randomUUID()})).rejects.toThrow();
    for(const runId of [started.runId,randomUUID()]){
      const mismatch=await f.app.dispatch('dispatch.executionReport',{...query,runId});
      expect(mismatch.execution).toBe('unknown');expect(mismatch.tools.available).toBe(false);expect(mismatch.candidate).toBeUndefined();expect(mismatch.log.state).not.toBe('verified');
    }
    expect(await files.read()).toEqual(before);expect(await graph()).toEqual(graphBefore);expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(success?5:3);
    if(!success){
      // Explicit fault injection only after all real runs settled. The original bytes are restored
      // before cleanup, and none of these reads may infer success from cached UI/run state.
      await fs.rename(files.log,files.log+'.test-backup');
      try{const missing=await f.app.dispatch('dispatch.executionReport',query);expect(missing.execution).toBe('unknown');expect(missing.log.state).toBe('missing');expect(missing.tools.available).toBe(false)}
      finally{await fs.rename(files.log+'.test-backup',files.log)}
      await fs.appendFile(files.log,'{"incomplete_test_tail":');
      try{const truncated=await f.app.dispatch('dispatch.executionReport',query);expect(truncated.execution).toBe('unknown');expect(truncated.log.state).toBe('incomplete')}
      finally{await fs.writeFile(files.log,before.log)}
      expect((await f.app.dispatch('dispatch.executionReport',query)).log.state).toBe('verified');
      expect(await fs.readFile(path.join(f.a,data.marker),'utf8')).toBe(data.fact);
      expect(await files.read()).toEqual(before);expect(await graph()).toEqual(graphBefore);expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(3);
    }
    expect(provider.errors).toEqual([]);
  }finally{provider.release();await f.cleanup();await provider.close()}
},120000);
