import {expect,it} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import type {DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import {controlledFileChangeSchema,type ControlledFileChange} from '../src/logic/file-operations/rules/controlled-file-event';
import {controlledFileReportSchema,fileCompensationPreviewSchema,fileCompensationReceiptSchema,type ControlledFileReportInput,type FileCompensationInput} from '../src/logic/file-operations/rules/controlled-file-operation';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {controlledFileProvider,controlledFileFixture as data,controlledFact,type ControlledFileMode} from './controlled-file-provider';
import {createControlledHost,holdControlledReadonlyMapping} from './controlled-file-electron-fixture';
import {additionRecords} from './queued-dependency-addition-fixture';
import {effectPersistedRunBytes,archiveEffectRuns,effectRunEvidence} from './effect-observation-fixture';
import {effectObservationReportSchema,effectDispositionReceiptSchema} from '../src/logic/tasks/rules/effect-observation';

async function changes(user:string,id:string){const raw=await fs.readFile(path.join(user,id,'dispatch','dispatch.jsonl'),'utf8');return raw.trim().split('\n').flatMap(line=>((JSON.parse(line)as {body:{mutation:DispatchMutation}}).body.mutation.controlledFileChanges??[]).map(change=>controlledFileChangeSchema.parse(change)))}
async function until(check:()=>Promise<boolean>,provider:Awaited<ReturnType<typeof controlledFileProvider>>,label:string){const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('Controlled file Pi timeout: '+label)}

it.each([{mode:'complete'},{mode:'partial'},{mode:'bad-wire'},{mode:'stop-before'},{mode:'partial',adversarial:true},{mode:'bad-wire',adversarial:true}] as {mode:ControlledFileMode;adversarial?:boolean}[])('uses actual Electron utility/Pi and preserves original evidence ($mode, adversarial=$adversarial)',async({mode,adversarial=false})=>{
  const provider=await controlledFileProvider(mode,adversarial);let host=await createControlledHost(),mapping:Awaited<ReturnType<typeof holdControlledReadonlyMapping>>|undefined,keep=false;
  const evidenceTag=mode+(adversarial?'-adversarial':'')+'-effect';
  const evidenceFile='test-results/controlled-file-'+evidenceTag+'-pi-evidence.json';
  try{
    const seeded=await host.seed(provider.url);provider.bind(seeded.agentId,seeded.moduleId,seeded.selection);const id=seeded.entry.id;
    if(mode==='partial')mapping=await holdControlledReadonlyMapping(host.root,path.join(host.project,data.file));
    if(mode==='bad-wire')await host.request('corrupt-applied-output',{workspaceId:id});
    if(mode==='stop-before')await host.request('hold-before-write');
    const started=await host.dispatch('loop.chat',{id,message:data.goal,options:seeded.options}),rootSessionId=started.taskId as string;
    if(mode==='stop-before'){
      await until(async()=>(await host.request('fault-status')).beforeWriteReached,provider,'real executing saved before apply');
      const stopped=host.dispatch('loop.stop',{id,taskId:rootSessionId});
      await until(async()=>(await host.request('fault-status')).signalAborted,provider,'actual stop signal reaches file session');
      await host.request('release-before-write');await stopped;
    }
    await until(async()=>{const records=await additionRecords(host.user,id);return records.scopes.some(scope=>scope.rootSessionId===rootSessionId)&&records.scopes.every(scope=>scope.status==='closed')&&(await host.dispatch('runtime.snapshot',{})).pressure.activeRuns===0},provider,'scope and all actual runs closed');
    const records=await additionRecords(host.user,id),graph:GraphSnapshot=await host.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId}}),task=graph.tasks[0];assert.ok(task);expect(task.runIds).toHaveLength(1);expect(records.runs).toHaveLength(1);
    const run=records.runs[0],query:ControlledFileReportInput={workspaceId:id,rootSessionId,taskId:task.taskId,runId:run.binding.runId,toolCallId:'controlled-write'};
    const report=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query));assert.equal(report.ledger.state,'recorded');const original=report.ledger.operation;
    expect(original.binding).toEqual(run.binding);expect(original.before).toEqual(controlledFact(data.before));expect(original.intendedAfter).toEqual(controlledFact(data.after));
    const originalChanges=await changes(host.user,id);expect(originalChanges.map(item=>item.phase)).toEqual(['prepared','executing',mode==='partial'?'unknown':mode==='stop-before'?'not_applied':'applied']);
    const prepared=originalChanges[0];assert.equal(prepared.phase,'prepared');assert.equal(prepared.intent.kind,'member_write');expect(prepared.intent.request.expectedBefore).toEqual(controlledFact(data.before));
    const blobs=path.join(host.user,id,'controlled-files','blobs');expect(await fs.readFile(path.join(blobs,prepared.intent.before.blobId))).toEqual(Buffer.from(data.before));expect(await fs.readFile(path.join(blobs,prepared.intent.intendedAfter.blobId))).toEqual(Buffer.from(data.after));
    const summary=await new FileRunStorage().read(path.join(host.user,id,'dispatch','runs','tasks',task.taskId,run.binding.runId)),finished=summary.events.filter(event=>event.type==='tool.finished'&&event.data.id==='controlled-write');
    if(mode==='complete'){expect(task.status).toBe('result_ready');expect(records.scopes[0].outcome).toBe('completed');expect(task.result?.evidenceRefs).toEqual(['controlled-after-read','controlled-validation']);expect(summary.taskProgress?.steps.flatMap(item=>item.evidence).includes('controlled-before-read')).toBe(false);expect(finished).toHaveLength(1);expect(finished[0].data.receipt).toMatchObject({outcome:'succeeded'})}
    else {expect(task.result).toBeUndefined();expect(records.scopes[0].outcome).toBe(mode==='stop-before'?'cancelled':'failed');if(mode==='bad-wire'){expect(finished).toHaveLength(1);expect(JSON.stringify(finished[0])).toContain('TOOL_OUTPUT_INVALID')}}
    if(adversarial){
      expect(summary.status).toBe('interrupted');expect(task.status).toBe('interrupted');expect(task.help).toBeUndefined();expect(task.result).toBeUndefined();
      expect(finished[0].data.receipt).toMatchObject({outcome:'failed'});expect(summary.events.at(-1)?.data.unverifiedControlledCalls).toEqual(['controlled-write']);
      for(const suffix of ['controlled','write','edit','bash','delivery']){const callId='controlled-bypass-'+suffix;expect(summary.events.filter(event=>event.type==='tool.proposed'&&event.data.id===callId)).toHaveLength(1);expect(summary.events.some(event=>event.type==='tool.allowed'&&event.data.id===callId)).toBe(false);expect(summary.toolReceipts!.find(receipt=>receipt.toolCallId===callId)?.outcome).toBe('denied')}
      expect(summary.toolReceipts!.find(receipt=>receipt.toolCallId==='controlled-recheck-read')?.outcome).toBe('succeeded');expect(summary.events.some(event=>event.type==='task.help_requested')).toBe(true);
      expect(provider.state.observedText).toBe(await fs.readFile(path.join(host.project,data.file),'utf8'));
    }
    const originalFileBytes=await fs.readFile(path.join(host.project,data.file)),runs=await effectPersistedRunBytes(host.user,id,rootSessionId),snapshot=await host.dispatch('snapshot',{id}),previewInput={workspaceId:id,instanceId:snapshot.instanceId,rootSessionId,operationId:original.operationId};
    const traceBefore=await host.trace(),journalFile=path.join(host.user,id,'dispatch','dispatch.jsonl'),journalBefore=await fs.readFile(journalFile);
    expect(controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query)).ledger).toEqual(report.ledger);expect(await fs.readFile(journalFile)).toEqual(journalBefore);expect(await host.trace()).toEqual(traceBefore);
    const selection={workspaceId:id,rootSessionId,subject:{kind:'member_run',taskId:task.taskId,runId:run.binding.runId,toolCallIds:[query.toolCallId]}},effectOriginal=effectObservationReportSchema.parse(await host.dispatch('dispatch.effectObserve',selection));
    expect(effectOriginal.calls[0]).toMatchObject({coverage:'controlled_file',controlled:report.ledger});expect(effectOriginal.consistency).toBe('stable');expect(await host.trace()).toEqual(traceBefore);expect(await fs.readFile(journalFile)).toEqual(journalBefore);
    const wrongRoot=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',{...query,rootSessionId:'unrelated-root'}));expect(wrongRoot.ledger.state).not.toBe('recorded');expect(JSON.stringify(wrongRoot)).not.toContain(original.operationId);
    let compensationRequest:FileCompensationInput|undefined,compensation:ReturnType<typeof fileCompensationReceiptSchema.parse>|undefined;
    if(mode==='complete'){
      expect(await fs.readFile(path.join(host.project,data.file),'utf8')).toBe(data.after);
      const preview=fileCompensationPreviewSchema.parse(await host.dispatch('dispatch.fileCompensationPreview',previewInput));expect(preview.eligible).toBe(true);assert.ok(preview.basis);expect(preview.restore).toEqual(controlledFact(data.before));
      compensationRequest={...previewInput,commandId:randomUUID(),expectedOperationRevision:3,expectedCompensationRevision:preview.compensationRevision,expectedBasis:preview.basis,reason:'明确恢复真实保存的原字节；不改旧任务审阅结论。'};
      compensation=fileCompensationReceiptSchema.parse(await host.dispatch('dispatch.fileCompensate',compensationRequest));expect(compensation.phase).toBe('applied');expect(await fs.readFile(path.join(host.project,data.file))).toEqual(Buffer.from(data.before));
      const after=await fs.readFile(journalFile),trace=await host.trace();expect(await host.dispatch('dispatch.fileCompensate',compensationRequest)).toEqual(compensation);expect(await host.dispatch('dispatch.fileCompensationReceipt',{workspaceId:id,rootSessionId,commandId:compensationRequest.commandId})).toEqual(compensation);expect(await fs.readFile(journalFile)).toEqual(after);expect(await host.trace()).toEqual(trace);
      expect((await changes(host.user,id)).map(item=>item.phase)).toEqual(['prepared','executing','applied','prepared','executing','applied']);expect((await changes(host.user,id)).slice(0,3)).toEqual(originalChanges);
    }else if(mode==='partial'){
      const bytes=await fs.readFile(path.join(host.project,data.file));expect(bytes.length).toBe(Buffer.byteLength(data.before));expect(bytes.subarray(0,Buffer.byteLength(data.after))).toEqual(Buffer.from(data.after));expect(bytes).not.toEqual(Buffer.from(data.before));expect(bytes).not.toEqual(Buffer.from(data.after));
      await mapping!.release();mapping=undefined;
      const preview=fileCompensationPreviewSchema.parse(await host.dispatch('dispatch.fileCompensationPreview',previewInput));expect(preview.eligible).toBe(false);expect(preview.source.phase).toBe('unknown');expect(preview.basis).toBeUndefined();expect(await fs.readFile(journalFile)).toEqual(journalBefore);
    }else if(mode==='stop-before'){expect(await fs.readFile(path.join(host.project,data.file))).toEqual(Buffer.from(data.before));expect(traceBefore.some(item=>item.kind==='replace-confirmed')).toBe(false)}
    else expect(await fs.readFile(path.join(host.project,data.file),'utf8')).toBe(data.after);
    expect(await additionRecords(host.user,id)).toEqual(records);expect(await host.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId}})).toEqual(graph);expect(await effectPersistedRunBytes(host.user,id,rootSessionId)).toEqual(runs);
    const effectFinal=effectObservationReportSchema.parse(await host.dispatch('dispatch.effectObserve',selection)),effectRequest={...selection,commandId:randomUUID(),expectedBasis:effectFinal.basis,expectedRevision:effectFinal.dispositionRevision,decision:'inspect_more',reason:'只核实受控原阶段和独立补偿；原工具结果及业务验收不变'};
    if(compensation){expect(effectFinal.basis).not.toBe(effectOriginal.basis);await expect(host.dispatch('dispatch.effectDisposition',{...effectRequest,expectedBasis:effectOriginal.basis})).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'})}
    const beforeDispositionTrace=await host.trace(),beforeDispositionBytes=await fs.readFile(path.join(host.project,data.file));
    const effectSaved=effectDispositionReceiptSchema.parse(await host.dispatch('dispatch.effectDisposition',effectRequest)),effectLookup={workspaceId:id,rootSessionId,commandId:effectRequest.commandId};expect(effectSaved.record.observation.calls).toEqual(effectFinal.calls);expect(await host.dispatch('dispatch.effectDispositionReceipt',effectLookup)).toEqual(effectSaved);expect(await host.trace()).toEqual(beforeDispositionTrace);expect(await fs.readFile(path.join(host.project,data.file))).toEqual(beforeDispositionBytes);
    const finalJournal=await fs.readFile(journalFile),finalReport=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query)),counts={main:provider.main.length,member:provider.member.length,other:provider.other.length},trace=await host.trace();
    expect(counts).toEqual({main:mode==='stop-before'?3:6,member:adversarial?13:mode==='complete'?11:mode==='stop-before'?4:5,other:0});expect(trace.filter(item=>item.kind==='replace-enter')).toHaveLength(mode==='complete'?2:1);expect(trace.filter(item=>item.kind==='replace-confirmed')).toHaveLength(mode==='complete'?2:mode==='bad-wire'?1:0);
    const byteDirectory='test-results/controlled-file-'+evidenceTag+'-pi-bytes';await archiveEffectRuns(byteDirectory,host.user,id,runs);await fs.writeFile(path.join(byteDirectory,'observed-after-original.bin'),originalFileBytes);await fs.writeFile(path.join(byteDirectory,'observed-final.bin'),await fs.readFile(path.join(host.project,data.file)));await fs.copyFile(path.join(blobs,prepared.intent.before.blobId),path.join(byteDirectory,'actual-before-blob.bin'));await fs.copyFile(path.join(blobs,prepared.intent.intendedAfter.blobId),path.join(byteDirectory,'actual-intended-after-blob.bin'));
    const root=host.root,diagnostics=host.diagnostics();await host.close();host=await createControlledHost({root});
    expect(controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query)).ledger).toEqual(finalReport.ledger);
    const effectReopened=effectObservationReportSchema.parse(await host.dispatch('dispatch.effectObserve',selection));expect(effectReopened.calls).toEqual(effectFinal.calls);expect(effectReopened.basis).toBe(effectFinal.basis);expect(await host.dispatch('dispatch.effectDispositionReceipt',effectLookup)).toEqual(effectSaved);
    if(compensationRequest)expect(await host.dispatch('dispatch.fileCompensationReceipt',{workspaceId:id,rootSessionId,commandId:compensationRequest.commandId})).toEqual(compensation);
    expect(await additionRecords(host.user,id)).toEqual(records);expect(await effectPersistedRunBytes(host.user,id,rootSessionId)).toEqual(runs);expect(await fs.readFile(journalFile)).toEqual(finalJournal);expect(await host.trace()).toEqual([]);expect({main:provider.main.length,member:provider.member.length,other:provider.other.length}).toEqual(counts);
    await fs.writeFile(evidenceFile,JSON.stringify({mode,adversarial,actualElectron:true,actualUtilityProcess:true,localDeterministicProvider:true,query,report,finalReport,effectOriginal,effectFinal,effectSaved,effectReopened,originalChanges,compensation,trace,counts,runs:effectRunEvidence(runs),reopenNoReplay:true,oldCanonicalNativeUnchanged:true,originalTaskScopeReviewUnchanged:true,diagnostics},null,2));
  }catch(error){keep=true;await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/controlled-file-'+evidenceTag+'-pi-failure.json',JSON.stringify({root:host.root,error:String(error),stack:error instanceof Error?error.stack:undefined,remoteStack:(error as {remoteStack?:string})?.remoteStack,counts:{main:provider.main.length,member:provider.member.length},providerErrors:provider.errors,trace:await host.trace().catch(()=>undefined),diagnostics:host.diagnostics(),lastMember:provider.member.at(-1)},null,2));throw error}
  finally{await mapping?.release();await host.request('release-before-write').catch(()=>{});await host.close();await provider.close();if(!keep)await host.remove()}
},180000);
