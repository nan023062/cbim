import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {ArtifactFiles,normalizeArtifactPath} from '../src/logic/file-operations/platform/files/artifact-files';
import type {ArtifactFileCheck} from '../src/logic/evidence/rules/artifact-baseline';
import {prepareDispatchExecutionContext} from '../src/logic/execution/context/execution-context';
import {resolveDispatchModules} from '../src/logic/execution/context/dispatch-context';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {memberWorkflowFiles,validateMemberWorkflow} from '../src/logic/team/runtime/member-workflow';
import {humanDecisionPreviewSchema,humanDecisionReceiptSchema} from '../src/logic/tasks/rules/human-decisions';
import {humanContinuationReceiptSchema,type HumanContinuationRequest} from '../src/logic/tasks/rules/human-continue';
import {jsonValidationProvider,jsonValidationFixture,type JsonValidationMode} from './json-validation-provider';
import {seedJsonValidation,jsonValidationRecords,jsonValidationLogBytes} from './json-validation-fixture';
import {csvValidationData} from './csv-validation-data';
import {seedCsvValidation} from './csv-validation-fixture';
import {pngValidationData} from './png-validation-data';
import {seedPngValidation} from './png-validation-fixture';

const formats=[{kind:'JSON',data:jsonValidationFixture,seed:seedJsonValidation,validator:'json-schema-v1'},{kind:'CSV',data:csvValidationData,seed:seedCsvValidation,validator:'csv-table-v1'},{kind:'PNG',data:pngValidationData,seed:seedPngValidation,validator:'png-raster-v1'}] as const;

it.each(formats.flatMap(format=>(['complete','changed','stop']as const).map(mode=>({...format,mode}))))('validates actual $kind bytes and preserves evidence boundaries ($mode)',async({kind,data,seed,validator,mode})=>{
  const payload=(value:string)=>kind==='PNG'?Buffer.from(value,'base64'):Buffer.from(value);
  const f=await fixture(),provider=await jsonValidationProvider(mode,data,true);let app=f.app;
  try{
    const {entry,team}=await seed(app,f.a,provider);
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const records=()=>jsonValidationRecords(f.user,entry.id),file=path.join(f.a,data.file);
    const until=async(condition:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await condition()},{timeout:45000,interval:30});expect(provider.errors).toEqual([])};
    await until(()=>expect(provider.state.deniedDelivery).toBeTruthy());
    expect(provider.main).toHaveLength(1);expect(provider.member).toHaveLength(9);
    expect(await fs.readFile(file)).toEqual(payload(data.bad));
    const rejected=provider.state.rejected.validation;
    expect(rejected).toMatchObject({outcome:'rejected',validator,requirement:{moduleId:team.input.moduleId,requirementId:data.requirementId}});
    expect(rejected.artifact).toMatchObject({relativePath:data.file,byteLength:payload(data.bad).length,sha256:createHash('sha256').update(payload(data.bad)).digest('hex')});
    expect(rejected.binding).toMatchObject({workspaceId:entry.id,rootSessionId:started.taskId});
    expect(rejected.taskProgressVersion).toBe(provider.state.badProgress.plan.version);
    expect(JSON.stringify(rejected.issues)).not.toContain('not-an-integer');
    if(kind==='CSV')expect(rejected.issues.map((issue:{code:string})=>issue.code)).toEqual(['csv_value','csv_duplicate']);
    if(kind==='PNG')expect(rejected.issues.map((issue:{code:string})=>issue.code)).toEqual(['png_dimensions']);
    expect(rejected.baselineId).toBe(provider.state.badCapture.baseline.baselineId);
    expect(provider.state.deniedDelivery).toMatchObject({code:'WORKFLOW_VALIDATION_REQUIRED',retryable:false});
    if(mode==='stop'){await app.dispatch('loop.stop',{id:entry.id,taskId:started.taskId});provider.releaseAll()}
    else{
      provider.releaseRepair();await until(()=>expect(provider.state.readyForReview).toBe(true));
      expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(16);
      expect(await fs.readFile(file)).toEqual(payload(data.good));
      const passed=provider.state.passed.validation;
      expect(passed.binding).toEqual(rejected.binding);expect(passed.requirement).toEqual(rejected.requirement);
      expect(passed.artifact).toMatchObject({byteLength:payload(data.good).length,sha256:createHash('sha256').update(payload(data.good)).digest('hex')});
      expect(passed.baselineId).toBe(provider.state.freshCapture.baseline.baselineId);
      expect(JSON.stringify(provider.state.delivery.delivery.workflow.validationChecks)).toContain(passed.validationId);
      expect(JSON.stringify(provider.state.delivery.delivery.workflow.validationChecks)).not.toContain(rejected.validationId);
      expect(provider.state.call.verification).toMatchObject({state:'verified',files:[passed.artifact],acceptance:'not_evaluated'});
      if(mode==='changed')await fs.writeFile(file,payload(data.changed));provider.releaseReview();
    }
    await until(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)});
    const saved=await records(),rootDir=path.join(f.user,entry.id,'loop-engine','tasks');
    const root=await new FileRunStorage().read(path.join(rootDir,started.taskId,started.runId));
    const reference=root.events.find(e=>e.type==='tool.updated'&&e.data.agentCall)?.data.agentCall as {taskId:string;runId:string};
    expect(reference).toBeTruthy();expect(reference.taskId).toBe(rejected.binding.taskId);expect(reference.runId).toBe(rejected.binding.runId);
    const summary=await new FileRunStorage().read(path.join(rootDir,reference.taskId,reference.runId));
    expect(summary.events[0].data).toMatchObject({executionModel:'agent-tools-v1',agentCall:{callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'json-agent-call'}});
    expect(summary.status).toBe(mode==='stop'?'cancelled':'completed');
    expect(provider.main).toHaveLength(mode==='stop'?1:3);expect(provider.member).toHaveLength(mode==='stop'?9:16);
    if(mode==='changed')expect(provider.state.reviewError.error.code).toBe('WORKFLOW_VALIDATION_STALE');
    else if(mode==='complete')expect(provider.state.check.state).toBe('verified');
    else {expect(summary.taskProgress?.delivery).toBeUndefined();expect(saved.scopes[0].outcome).toBe('cancelled')}
    // Recheck the actual canonical run with the same frozen knowledge, including malformed platform receipts.
    if(mode!=='stop'){
      const workspace=app.workspace(entry.id),snapshot=await workspace.snapshot(),binding=summary.memberBinding!,taskSpec=summary.task,now=new Date().toISOString();
      const assignee={agentId:binding.agentId,agentInstanceId:binding.agentInstanceId,agentSessionId:binding.agentSessionId,name:'验证 Agent'};
      const task:TaskNode={kind:'task',nodeId:taskSpec.taskId,taskId:taskSpec.taskId,identity:{workspaceId:entry.id,rootSessionId:started.taskId},requester:assignee,assignee,modules:await resolveDispatchModules(snapshot,taskSpec.moduleIds),ownerBinding:taskSpec.ownerBinding,goal:taskSpec.goal,acceptance:taskSpec.acceptance.map((text,index)=>({id:'criterion-'+index,text})),revision:1,planRevision:1,status:'result_ready',awaitedChildren:[],runIds:[summary.runId],createdAt:now,updatedAt:now};
      const member=(await app.dispatch('workspace.members.get',{workspaceId:entry.id,instanceId:workspace.instanceId,memberId:taskSpec.ownerBinding!.memberId})) as any;
      const prepared=await prepareDispatchExecutionContext(workspace,task,snapshot,member.member);
      const run:DispatchRun={binding,assignmentMessageId:task.taskId,status:'completed',prepared,model:(await app.models.resolve()).profile,permission:'execute',session:{nativeSessionId:String(summary.events[0].data.nativeSessionId),sessionFile:summary.sessionFile},createdAt:now};
      const normalizePath=(raw:string)=>normalizeArtifactPath(f.a,raw),platform=new ArtifactFiles(f.a,()=>{}),files=memberWorkflowFiles(task,run,summary,f.a,normalizePath);
      expect(files).toEqual([provider.state.passed.validation.artifact]);
      await expect(validateMemberWorkflow(task,run,summary,f.a)).rejects.toMatchObject({code:'WORKFLOW_VALIDATION_UNAVAILABLE'});
      const check=()=>validateMemberWorkflow(task,run,summary,f.a,{normalizePath,checkFiles:platform.checkFiles.bind(platform)});
      if(mode==='changed'){await expect(check()).rejects.toMatchObject({code:'WORKFLOW_VALIDATION_STALE'});expect(memberWorkflowFiles(task,run,summary,f.a,normalizePath)).toEqual(files)}
      else{
        await expect(check()).resolves.toBeUndefined();
        const expected={byteLength:files[0].byteLength,sha256:files[0].sha256},valid:ArtifactFileCheck={relativePath:files[0].relativePath,state:'matches',expected,observed:expected};
        const cases:ArtifactFileCheck[][]=[[{...valid,expected:{...expected,sha256:'0'.repeat(64)}}],[{...valid,observed:{...expected,sha256:'0'.repeat(64)}}],[{relativePath:valid.relativePath,state:'matches',expected}],[{relativePath:valid.relativePath,state:'missing',expected,reason:'test injection'}],[]];
        for(const checks of cases)await expect(validateMemberWorkflow(task,run,summary,f.a,{normalizePath,checkFiles:async()=>structuredClone(checks)})).rejects.toMatchObject({code:'WORKFLOW_VALIDATION_STALE'});
      }
    }
    const checks=summary.events.filter(e=>e.type==='validation.checked');
    expect(checks.map(e=>(e.data.validation as any).outcome)).toEqual(mode==='stop'?['rejected']:['rejected','passed']);
    for(const event of checks){const id=(event.data.validation as any).toolCallId,done=summary.events.find(e=>e.type==='tool.finished'&&e.data.id===id)!;expect(done.data.receipt).toMatchObject({outcome:'succeeded',toolName:'cbim_validation_run'});expect(event.seq).toBeLessThan(done.seq)}
    expect(summary.events.filter(e=>e.type==='tool.finished'&&e.data.name===(kind==='PNG'?'bash':'write')&&(e.data.receipt as any)?.outcome==='succeeded')).toHaveLength(mode==='stop'?1:2);
    const graph=await app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:started.taskId}});
    expect(graph.tasks).toHaveLength(0); // No legacy Team task was created to pass this regression.
    const bytes=await jsonValidationLogBytes(f.user,entry.id),counts={main:provider.main.length,member:provider.member.length},stat=await fs.stat(file);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
    expect(await records()).toEqual(saved);expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);
    expect({main:provider.main.length,member:provider.member.length}).toEqual(counts);expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
    expect(await fs.readFile(file)).toEqual(payload(mode==='stop'?data.bad:mode==='changed'?data.changed:data.good));expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/agent-${kind}-${mode}-failure.json`,JSON.stringify({error:String(error),providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)?.messages,lastMember:provider.member.at(-1)?.messages},null,2));throw error}
  finally{provider.releaseAll();await app.shutdown();await f.cleanup();await provider.close()}
},120000);

it.each(formats.flatMap(format=>(['reject','request_evidence']as const).map(decision=>({...format,decision}))))('preserves real negative human decisions after $kind bytes change ($decision)',async({kind,data,seed,decision})=>{
  const payload=(value:string)=>kind==='PNG'?Buffer.from(value,'base64'):Buffer.from(value);
  const f=await fixture(),provider=await jsonValidationProvider('human-negative',data);let app=f.app;
  try{
    provider.releaseRepair();provider.releaseReview();const {entry}=await seed(app,f.a,provider),started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),records=()=>jsonValidationRecords(f.user,entry.id),graphIdentity={workspaceId:entry.id,rootSessionId:started.taskId},graph=()=>app.dispatch('dispatch.graphSnapshot',{identity:graphIdentity}),file=path.join(f.a,data.file);
    const until=async(condition:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await condition()},{timeout:45000,interval:30});expect(provider.errors,JSON.stringify(provider.errors)).toEqual([])};
    await until(async()=>{expect((await records()).scopes[0].status).toBe('waiting');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)});const waiting=await records(),scope=waiting.scopes[0],originalGraph=await graph(),task=originalGraph.tasks[0],identity={...graphIdentity,scopeId:scope.scopeId},baselines=[{taskId:task.taskId,runId:task.result!.runId,baselineId:provider.state.freshCapture.baseline.baselineId}];expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(16);expect(await fs.readFile(file)).toEqual(payload(data.good));
    await fs.writeFile(file,payload(data.changed));const bytes=await jsonValidationLogBytes(f.user,entry.id),preview=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',{...identity,criterionId:data.humanId,baselines}));expect(preview.basis).toBeTruthy();expect(preview.allowedDecisions).toEqual(['reject','request_evidence']);expect(preview.candidates[0].selected?.files).toEqual([expect.objectContaining({relativePath:data.file,state:'changed',expected:{byteLength:payload(data.good).length,sha256:createHash('sha256').update(payload(data.good)).digest('hex')},observed:{byteLength:payload(data.changed).length,sha256:createHash('sha256').update(payload(data.changed)).digest('hex')}})]);
    const request={...identity,criterionId:data.humanId,baselines,commandId:randomUUID(),expectedDecisionRevision:preview.decisionRevision,expectedBasis:preview.basis!,decision,comment:'当前真实产物已变化，明确记录'+decision+'；保存不授权旧成果通过或自动继续。'};
    await expect(app.dispatch('dispatch.humanDecide',{...request,commandId:randomUUID(),decision:'accept'})).rejects.toThrow();expect(await records()).toEqual(waiting);
    const receipt=humanDecisionReceiptSchema.parse(await app.dispatch('dispatch.humanDecide',request));expect(humanDecisionReceiptSchema.parse(await app.dispatch('dispatch.humanDecide',request))).toEqual(receipt);expect(receipt.record).toMatchObject({decision,proof:{source:{waitId:scope.wait!.waitId},allowedDecisions:['reject','request_evidence']}});const decided=await records();expect(decided.scopes[0].humanDecisions?.records).toEqual([receipt.record]);expect(decided.scopes[0].status).toBe('waiting');expect(decided.scopes[0].goal).toEqual(scope.goal);expect(decided.scopes[0].wait).toEqual(scope.wait);expect(await graph()).toEqual(originalGraph);expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(16);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();expect(await records()).toEqual(decided);expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(bytes);expect(provider.main).toHaveLength(6);
    const profileId=(await app.models.list()).selectedId!,continuationRequest:HumanContinuationRequest={...identity,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:receipt.decisionRevision,commandId:randomUUID(),decisionIds:[receipt.record.decisionId],options:{profileId,provider:'cbim-'+profileId,model:data.model,permission:'execute',turnTimeoutMs:60000}},continued=humanContinuationReceiptSchema.parse(await app.dispatch('loop.humanContinue',continuationRequest));
    expect(continued.continuation).toMatchObject({kind:'human_decisions',decisionIds:[receipt.record.decisionId],inputRevision:2});expect(continued.continuation).not.toHaveProperty('input');await until(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)});
    const saved=await records();expect(saved.scopes[0].outcome).toBe('failed');expect(saved.scopes[0].goal?.review?.decision).toBe('blocked');expect(saved.scopes[0].goal?.input).toEqual(scope.goal?.input);expect(saved.scopes[0].humanDecisions).toEqual(decided.scopes[0].humanDecisions);expect(saved.scopes[0].continuations).toEqual([continued.continuation]);expect(await graph()).toEqual({...originalGraph,cursor:{...originalGraph.cursor,seq:originalGraph.cursor.seq+1},agents:originalGraph.agents.map((agent:GraphSnapshot['agents'][number])=>agent.agentInstanceId===task.assignee.agentInstanceId?{...agent,revision:agent.revision+1}:agent)});expect(saved.members.find(member=>member.agentInstanceId===task.assignee.agentInstanceId)?.lifecycle).toBe('released');expect(provider.main).toHaveLength(10);expect(provider.member).toHaveLength(16);expect(await fs.readFile(file)).toEqual(payload(data.changed));
    const newBytes=await jsonValidationLogBytes(f.user,entry.id);for(const [name,value]of Object.entries(bytes))if(name.endsWith('events.jsonl')||name.startsWith('dispatch/'))expect(newBytes[name]).toBe(value);const finalBytes=newBytes;await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();expect(await records()).toEqual(saved);expect(await jsonValidationLogBytes(f.user,entry.id)).toEqual(finalBytes);expect(humanContinuationReceiptSchema.parse(await app.dispatch('loop.humanContinue',continuationRequest)).continuation).toEqual(continued.continuation);expect(provider.main).toHaveLength(10);expect(provider.member).toHaveLength(16);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/${kind.toLowerCase()}-validation-human-${decision}-failure.json`,JSON.stringify({error:String(error),actual:(error as {actual?:unknown}).actual,expected:(error as {expected?:unknown}).expected,requests:{main:provider.main.length,member:provider.member.length},providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)?.messages,lastMember:provider.member.at(-1)?.messages},null,2));throw error}
  finally{provider.releaseAll();await app.shutdown();await f.cleanup();await provider.close()}
},120000);
