import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {artifactCaptureResultSchema,artifactReportSchema} from '../src/logic/evidence/rules/artifact-baseline';
import {artifactBaselineProvider,artifactBaselineFixture as data} from './artifact-baseline-provider';
import {seedArtifactBaseline,artifactBaselineRecords,artifactBaselineFiles,assertArtifactVerification} from './artifact-baseline-fixture';

it.each(['complete','stop'] as const)('captures real Pi read identities and inspects files without replay (%s)',async mode=>{
  const f=await fixture(),provider=await artifactBaselineProvider();let reopened:Application|undefined;
  try{
    const {entry}=await seedArtifactBaseline(f.app,f.a,provider),started=await f.app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'read',turnTimeoutMs:30000}}) as {taskId:string;runId:string};
    const identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>artifactBaselineRecords(f.user,entry.id),graph=()=>f.app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(()=>{expect(provider.member).toHaveLength(5);expect(provider.state.captured).toBeTruthy()},{timeout:30000,interval:30});
    const captured=artifactCaptureResultSchema.parse(provider.state.captured),running=(await graph()).tasks[0],query={...identity,taskId:running.taskId,runId:running.activeRunId!};
    expect(captured.baseline.binding).toMatchObject({...query,agentInstanceId:running.assignee.agentInstanceId,agentSessionId:running.assignee.agentSessionId,planRevision:running.planRevision});
    expect(captured.baseline.progressVersion).toBe(1);expect(captured.baseline.captureToolCallId).toBe('artifact-capture');expect(captured.baseline.sourceCalls.map(value=>value.toolCallId)).toEqual(['artifact-source-read','artifact-other-read']);
    expect(captured.baseline.files.map(value=>value.relativePath)).toEqual(data.files);
    const holdingRequests=[...provider.sequence];
    const list=artifactReportSchema.parse(await f.app.dispatch('dispatch.artifactReport',query));expect(list.verification).toBeUndefined();expect(list.baselines.map(value=>value.baselineId)).toEqual([captured.baseline.baselineId]);expect(provider.sequence).toEqual(holdingRequests);
    if(mode==='stop')await f.app.dispatch('loop.stop',{id:entry.id,taskId:identity.rootSessionId});
    provider.releaseMember();await vi.waitFor(async()=>expect((await records()).scopes[0].status).toBe('closed'),{timeout:30000,interval:30});
    const closedRecords=await records(),closedGraph=await graph();expect(closedRecords.scopes[0].outcome).toBe(mode==='complete'?'completed':'cancelled');expect(provider.main).toHaveLength(mode==='complete'?6:3);expect(provider.member).toHaveLength(mode==='complete'?7:5);
    const files=await artifactBaselineFiles(f.user,entry.id,query.taskId,query.runId),bytes=await files.read(),events=bytes.log.trim().split('\n').map(line=>JSON.parse(line)),capturedEvents=events.filter(event=>event.type==='artifact.baseline_captured');
    expect(capturedEvents).toHaveLength(1);expect(JSON.stringify(capturedEvents[0].data)).toContain(captured.baseline.baselineId);
    const captureFinished=events.find(event=>event.type==='tool.finished'&&event.data.id==='artifact-capture');expect(captureFinished.data.receipt.outcome).toBe('succeeded');expect(capturedEvents[0].seq).toBeLessThan(captureFinished.seq);
    if(mode==='complete'){expect(closedGraph.tasks[0].result?.evidenceRefs).not.toContain('artifact-capture');expect(closedGraph.tasks[0].result?.evidenceRefs).toEqual(expect.arrayContaining(['artifact-source-read','artifact-other-read']))}
    else expect(closedGraph.tasks[0].result).toBeUndefined();
    const selected={...query,baselineId:captured.baseline.baselineId},requests=[...provider.sequence];
    const matched=assertArtifactVerification(await f.app.dispatch('dispatch.artifactReport',selected),['matches','matches']);expect(matched.baselines[0].progressVersion).toBe(1);
    await fs.writeFile(path.join(f.a,data.files[0]),data.changed);assertArtifactVerification(await f.app.dispatch('dispatch.artifactReport',selected),['changed','matches']);
    await fs.unlink(path.join(f.a,data.files[1]));assertArtifactVerification(await f.app.dispatch('dispatch.artifactReport',selected),['changed','missing']);
    const listing=artifactReportSchema.parse(await f.app.dispatch('dispatch.artifactReport',query));expect(listing.verification).toBeUndefined();expect(listing.baselines).toEqual(matched.baselines);
    const serialized=JSON.stringify(listing);for(const privateValue of [f.a,f.user,data.facts[0],data.facts[1],'sessionFile'])expect(serialized).not.toContain(privateValue);
    expect(await files.read()).toEqual(bytes);expect(await graph()).toEqual(closedGraph);expect(await records()).toEqual(closedRecords);expect(provider.sequence).toEqual(requests);
    await f.app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();
    const restoredList=artifactReportSchema.parse(await reopened.dispatch('dispatch.artifactReport',query));expect(restoredList.verification).toBeUndefined();expect(restoredList.baselines).toEqual(matched.baselines);
    assertArtifactVerification(await reopened.dispatch('dispatch.artifactReport',selected),['changed','missing']);
    expect(await files.read()).toEqual(bytes);expect(await reopened.dispatch('dispatch.graphSnapshot',{identity})).toEqual(closedGraph);expect(await records()).toEqual(closedRecords);expect(provider.sequence).toEqual(requests);expect(provider.errors).toEqual([]);
  }finally{provider.releaseMember();if(reopened)await reopened.shutdown();await f.cleanup();await provider.close()}
},120000);
