import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createControlledHost,holdControlledReadonlyMapping} from './controlled-file-electron-fixture';
import {controlledFileProvider,controlledFileFixture as d,controlledFact} from './controlled-file-provider';
import {completeOutputRecords} from './complete-output-pi-fixture';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {controlledFileReportSchema,fileCompensationPreviewSchema,fileCompensationReceiptSchema} from '../src/logic/file-operations/rules/controlled-file-operation';

it.each(['complete','bad-wire','partial','stop-before'] as const)('recursive controlled file uses real utility, immutable audit and explicit compensation (%s)',async mode=>{
 const provider=await controlledFileProvider(mode,false,true);let host=await createControlledHost(),mapping:Awaited<ReturnType<typeof holdControlledReadonlyMapping>>|undefined,keep=false;
 try{
  const seeded=await host.seed(provider.url);provider.bind(seeded.agentId,seeded.moduleId,seeded.selection);const id=seeded.entry.id,file=path.join(host.project,d.file);
  if(mode==='partial')mapping=await holdControlledReadonlyMapping(host.root,file);
  if(mode==='bad-wire')await host.request('corrupt-applied-output',{workspaceId:id});
  if(mode==='stop-before')await host.request('hold-before-write');
  const start=await host.dispatch('loop.chat',{id,message:d.goal,options:seeded.options});
  const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:90000,interval:40});expect(provider.errors).toEqual([])};
  if(mode==='stop-before'){
   await until(async()=>expect((await host.request('fault-status')).beforeWriteReached).toBe(true));
   const stopping=host.dispatch('loop.stop',{id,taskId:start.taskId});
   await until(async()=>expect((await host.request('fault-status')).signalAborted).toBe(true));
   await host.request('release-before-write');await stopping;
  }
  await until(async()=>{expect((await completeOutputRecords(host.user,id)).scopes[0].status).toBe('closed');expect((await host.dispatch('runtime.snapshot',{})).pressure.activeRuns).toBe(0)});
  const journalFile=path.join(host.user,id,'dispatch/dispatch.jsonl'),journal=await fs.readFile(journalFile,'utf8'),mutations=journal.trim().split('\n').map(line=>JSON.parse(line).body.mutation);
  const registered=mutations.flatMap(m=>m.agentBusinessRuns??[]);expect(registered.map(r=>r.status)).toEqual(['active','closed']);
  const run=registered[1],b=run.binding,changes=mutations.flatMap(m=>m.controlledFileChanges??[]);
  expect(run.parent).toMatchObject({callerTaskId:start.taskId,callerRunId:start.runId,taskId:b.taskId,runId:b.runId});
  expect(changes.map(c=>c.phase)).toEqual(['prepared','executing',mode==='partial'?'unknown':mode==='stop-before'?'not_applied':'applied']);
  const query={workspaceId:id,rootSessionId:start.taskId,taskId:b.taskId,runId:b.runId,toolCallId:'controlled-write'};
  const report=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query));expect(report.ledger.state).toBe('recorded');
  if(report.ledger.state!=='recorded')throw Error('Missing controlled ledger');
  expect(report.ledger.originalExecution).toBe('settled');
  const childDir=path.join(host.user,id,'loop-engine/tasks',b.taskId,b.runId),summary=await new FileRunStorage().Read(childDir);
  const finished=summary.events.find(e=>e.type==='tool.finished'&&e.data.id==='controlled-write');
  if(mode==='bad-wire'){expect(finished?.data.isError).toBe(true);expect(JSON.stringify(finished)).toContain('TOOL_OUTPUT_INVALID')}
  if(mode==='complete'){expect(provider.state.call.verification.state).toBe('verified');expect(await fs.readFile(file,'utf8')).toBe(d.after)}
  if(mode==='stop-before')expect(await fs.readFile(file,'utf8')).toBe(d.before);
  if(mode==='partial'){const bytes=await fs.readFile(file);expect(bytes.length).toBe(Buffer.byteLength(d.before));expect(bytes.subarray(0,Buffer.byteLength(d.after))).toEqual(Buffer.from(d.after));expect(bytes).not.toEqual(Buffer.from(d.before));await mapping!.release();mapping=undefined}
  const snapshot=await host.dispatch('snapshot',{id}),previewInput={workspaceId:id,instanceId:snapshot.instanceId,rootSessionId:start.taskId,operationId:report.ledger.operation.operationId};
  const preview=fileCompensationPreviewSchema.parse(await host.dispatch('dispatch.fileCompensationPreview',previewInput));
  expect(preview.eligible).toBe(mode==='complete'||mode==='bad-wire');
  const childBytes=await fs.readFile(path.join(childDir,'events.jsonl'),'utf8');
  if(mode==='complete'){
   expect(preview.restore).toEqual(controlledFact(d.before));
   const request={...previewInput,commandId:randomUUID(),expectedOperationRevision:3,expectedCompensationRevision:preview.compensationRevision,expectedBasis:preview.basis!,reason:'Restore original saved bytes explicitly'};
   const receipt=fileCompensationReceiptSchema.parse(await host.dispatch('dispatch.fileCompensate',request));expect(receipt.phase).toBe('applied');
   expect(await fs.readFile(file,'utf8')).toBe(d.before);
   const bytes=await fs.readFile(journalFile),trace=await host.trace();
   expect(await host.dispatch('dispatch.fileCompensate',request)).toEqual(receipt);expect(await host.trace()).toEqual(trace);expect(await fs.readFile(journalFile)).toEqual(bytes);
  }
  expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);
  expect((await host.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:start.taskId}})).tasks).toHaveLength(0);
  const wrong=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',{...query,rootSessionId:'foreign'}));expect(wrong.ledger.state).not.toBe('recorded');expect(JSON.stringify(wrong)).not.toContain(report.ledger.operation.operationId);
  const finalReport=controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query)),finalJournal=await fs.readFile(journalFile),finalBytes=await fs.readFile(file),counts=[provider.main.length,provider.member.length],root=host.root;
  await host.close();host=await createControlledHost({root});
  expect(controlledFileReportSchema.parse(await host.dispatch('dispatch.controlledFileReport',query)).ledger).toEqual(finalReport.ledger);
  expect(await fs.readFile(journalFile)).toEqual(finalJournal);expect(await fs.readFile(file)).toEqual(finalBytes);expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);
  expect(await host.trace()).toEqual([]);expect([provider.main.length,provider.member.length]).toEqual(counts);
 }catch(error){keep=true;await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-controlled-'+mode+'.json',JSON.stringify({root:host.root,error:String(error),remoteStack:(error as any).remoteStack,providerErrors:provider.errors,state:provider.state,trace:await host.trace().catch(()=>undefined),last:provider.main.at(-1)},null,2));throw error}
 finally{await mapping?.release();await host.request('release-before-write').catch(()=>{});await host.close();await provider.close();if(!keep)await host.remove()}
},180000);
