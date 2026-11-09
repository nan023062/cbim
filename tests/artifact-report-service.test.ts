import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {artifactRuntimeFixture,seedProgress,invoke,captureInput,artifactBinding} from './artifact-runtime-fixture';
import {ArtifactReportService} from '../src/backend/scheduler-engine/execution/artifact-report-service';
import type {DispatchState} from '../src/backend/core/tasks/dispatch-storage';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import type {RunSummary} from '../src/backend/core/brain/types';

async function setup(){
  const f=await artifactRuntimeFixture(async c=>{await seedProgress(c);await invoke(c,'cbim_task_artifact_capture','capture',captureInput)}),summary=await (await f.start()).done;
  const baseline=(summary.events.find(event=>event.type==='artifact.baseline_captured')!.data.baseline as {baselineId:string}).baselineId;
  const identity={workspaceId:artifactBinding.workspaceId,rootSessionId:artifactBinding.rootSessionId},agent={agentId:artifactBinding.agentId,agentInstanceId:artifactBinding.agentInstanceId,agentSessionId:artifactBinding.agentSessionId,name:'执行者'};
  const state={workspaceId:identity.workspaceId,members:[],sessions:[],outbox:[],scopes:[{...identity,scopeId:'scope',status:'closed',outcome:'failed',createdAt:'2026-11-07T00:00:00Z',closedAt:'2026-11-07T00:01:00Z'}],runs:[{binding:artifactBinding,status:'completed',prepared:{knowledgeRevision:'knowledge-one'},session:{nativeSessionId:'native-one',sessionFile:summary.sessionFile}}],graphs:[{version:1,identity,cursor:{...identity,streamId:'stream',seq:5},root:{agent},edges:[],agents:[],tasks:[{kind:'task',identity,taskId:artifactBinding.taskId,nodeId:'task:'+artifactBinding.taskId,scopeId:'scope',requester:agent,assignee:agent,modules:f.task.moduleIds.map(moduleId=>({moduleId})),goal:f.task.goal,acceptance:f.task.acceptance.map((text,index)=>({id:'criterion-'+index,text})),status:'blocked',revision:3,planRevision:1,runIds:[artifactBinding.runId],awaitedChildren:[],createdAt:'2026-11-07T00:00:00Z',updatedAt:'2026-11-07T00:01:00Z'}]}]} as unknown as DispatchState;
  const inspect=vi.fn(async()=>structuredClone(summary)),read=vi.fn(async()=>structuredClone(state)),knowledge=vi.fn(async()=>({revision:'knowledge-one'})),checks=vi.fn((files:Parameters<typeof f.filePort.checkFiles>[0],signal:AbortSignal)=>f.filePort.checkFiles(files,signal)),release=vi.fn(),acquire=vi.fn(()=>release);
  const owner={entry:{id:identity.workspaceId,path:f.directory},assert:()=>{},read:knowledge} as unknown as Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>;
  const service=new ArtifactReportService(owner,{read},{inspect,normalizePath:f.port.normalizePath,checkFiles:checks,acquireRead:acquire}),input={...identity,taskId:artifactBinding.taskId,runId:artifactBinding.runId};
  return {...f,summary,state,service,input,baseline,inspect,read,knowledge,checks,release,acquire};
}

it('lists canonical refs without reading files, selected report is bounded and leaves original logs and graph unchanged',async()=>{
  const f=await setup();try{
    const file=path.join(f.directory,artifactBinding.taskId,artifactBinding.runId,'events.jsonl'),before=await fs.readFile(file,'utf8'),state=structuredClone(f.state);
    const listing=await f.service.read(f.input);expect(listing.baselines).toHaveLength(1);expect(listing.verification).toBeUndefined();expect(f.checks).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();
    const report=await f.service.read({...f.input,baselineId:f.baseline});expect(report.verification).toMatchObject({state:'matches',files:[{relativePath:'File.txt',state:'matches'}]});expect(f.release).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(file,'utf8')).toBe(before);expect(f.state).toEqual(state);expect(JSON.stringify(report)).not.toContain(f.directory);expect(JSON.stringify(report)).not.toContain('actual bytes');
  }finally{await f.cleanup()}
});

it('bad native binding, truncated log and receipt without staged event never trigger file reads',async()=>{
  const f=await setup();try{
    const cases:[(value:RunSummary)=>void,string][]=[
      [s=>{s.events.find(event=>event.type==='session.bound')!.data.sessionId='other-native'},'identity_mismatch'],
      [s=>{s.events=s.events.filter(event=>event.type!=='session.bound').map((event,index)=>({...event,seq:index+1}))},'invalid'],
      [s=>{s.logIntegrity={partialTail:true}},'incomplete'],
      [s=>{s.events=s.events.filter(event=>event.type!=='artifact.baseline_captured').map((event,index)=>({...event,seq:index+1}))},'verified'],
    ];
    for(const [mutate,logState] of cases){const value=structuredClone(f.summary);mutate(value);f.inspect.mockResolvedValue(value);const report=await f.service.read({...f.input,baselineId:f.baseline});expect(report.log.state).toBe(logState);expect(report.verification?.state).toBe('unverifiable');expect(report.baselines).toEqual([])}
    f.inspect.mockRejectedValue(Object.assign(Error('missing'),{code:'ENOENT'}));expect((await f.service.read({...f.input,baselineId:f.baseline})).log.state).toBe('missing');expect(f.checks).not.toHaveBeenCalled();
    await expect(f.service.read({...f.input,rootSessionId:'foreign'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
  }finally{await f.cleanup()}
});

it('knowledge mismatch remains explicit and a change during reading invalidates the combined observation',async()=>{
  const f=await setup();try{
    f.knowledge.mockResolvedValue({revision:'knowledge-new'});const old=await f.service.read({...f.input,baselineId:f.baseline});expect(old.issues.some(issue=>issue.code==='ARTIFACT_KNOWLEDGE_CHANGED')).toBe(true);expect(old.verification?.state).toBe('matches');
    f.knowledge.mockResolvedValueOnce({revision:'knowledge-one'}).mockResolvedValueOnce({revision:'knowledge-next'});
    const changed=await f.service.read({...f.input,baselineId:f.baseline});expect(changed.consistency).toBe('changed_during_read');expect(changed.verification?.state).toBe('unverifiable');expect(f.release).toHaveBeenCalledTimes(2);
  }finally{await f.cleanup()}
});

it('dispatch and canonical log changes across a file read reject a stable combination without repairing either source',async()=>{
  const f=await setup();try{
    f.checks.mockImplementationOnce(async(files,signal)=>{const result=await f.filePort.checkFiles(files,signal);f.state.graphs[0].cursor.seq++;return result});
    const changed=await f.service.read({...f.input,baselineId:f.baseline});expect(changed.consistency).toBe('changed_during_read');expect(changed.verification?.state).toBe('unverifiable');expect(changed.issues.some(issue=>issue.code==='ARTIFACT_STATE_CHANGED')).toBe(true);
    f.inspect.mockResolvedValueOnce(structuredClone(f.summary)).mockRejectedValueOnce(Error('late log unavailable'));
    const logChanged=await f.service.read({...f.input,baselineId:f.baseline});expect(logChanged.consistency).toBe('changed_during_read');expect(logChanged.verification?.state).toBe('unverifiable');expect(logChanged.issues.some(issue=>issue.code==='ARTIFACT_LOG_CHANGED')).toBe(true);
  }finally{await f.cleanup()}
});

it('active runs and unavailable leases produce explicit unverifiable results without silently trying a different baseline',async()=>{
  const f=await setup();try{
    f.state.runs![0].status='running';const active=await f.service.read({...f.input,baselineId:f.baseline});expect(active.verification?.state).toBe('unverifiable');expect(f.checks).not.toHaveBeenCalled();
    f.state.runs![0].status='completed';f.acquire.mockImplementation(()=>{throw Error('workspace busy')});const busy=await f.service.read({...f.input,baselineId:f.baseline});expect(busy.verification?.state).toBe('unverifiable');expect(busy.issues.some(issue=>issue.code==='ARTIFACT_READ_BUSY')).toBe(true);
    const absent=await f.service.read({...f.input,baselineId:'unknown-baseline'});expect(absent.verification?.state).toBe('unverifiable');expect(f.checks).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
