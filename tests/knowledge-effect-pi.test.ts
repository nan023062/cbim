import {knowledgeRefreshProvider} from './knowledge-refresh-provider';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {moduleFiles,request as changeRequest} from './data/knowledge';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {RunSummary} from '../src/logic/execution/rules/types';
import {knowledgeContractProvider,knowledgeContractFixture as data} from './knowledge-contract-provider';
import {seedKnowledgeContract,knowledgeContractRecords,knowledgeContractLogBytes} from './knowledge-contract-fixture';
import {effectObservationReportSchema,effectDispositionReceiptSchema} from '../src/logic/tasks/rules/effect-observation';
import {hash} from '../src/core/platform/node/serialization';
import {knowledgeEffectObjectProvider} from './knowledge-effect-object-provider';

it.each(['direct','object','refresh'] as const)('真实 Pi %s 已提交知识后坏输出：原调用仍失败，原事务可核实与明确处置，重开零写入重放',async kind=>{
 const f=await fixture(),provider=kind==='direct'?await knowledgeContractProvider('malformed-after-commit'):kind==='refresh'?await knowledgeRefreshProvider():await knowledgeEffectObjectProvider(),callId=kind==='direct'?'contract-commit':kind==='refresh'?'refresh-commit':'object-commit',requestCount=kind==='direct'?11:8;let app=f.app;
 try{
  const {entry}=await seedKnowledgeContract(app,f.a,provider),workspace=app.workspace(entry.id);if(kind==='object')await workspace.commit(changeRequest(await workspace.snapshot(),moduleFiles()));if(kind==='refresh')for(const file of moduleFiles()){const target=path.join(f.a,file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.text)}
  const actual=workspace.commit.bind(workspace),actualPlanned=workspace.commitPlanned.bind(workspace);
  const commits=vi.spyOn(workspace,'commit').mockImplementation(async input=>{const result=await actual(input);return {...result,changed:'PRIVATE_INVALID_OUTPUT_SENTINEL'} as unknown as typeof result});
  const planned=vi.spyOn(workspace,'commitPlanned').mockImplementation(async input=>{const result=await actualPlanned(input);return {...result,changed:'PRIVATE_INVALID_OUTPUT_SENTINEL'} as unknown as typeof result});
  const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>knowledgeContractRecords(f.user,entry.id);
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:60000,interval:30});
  expect(commits).toHaveBeenCalledTimes(kind!=='object'?1:0);expect(planned).toHaveBeenCalledTimes(kind==='object'?1:0);expect(provider.requests).toHaveLength(requestCount);const summary=await app.dispatch('loop.inspect',{id:entry.id,taskId:started.taskId,runId:started.runId}) as RunSummary;expect(summary.toolReceipts?.find(r=>r.toolCallId===callId)).toMatchObject({outcome:'failed',effects:['knowledge-write']});if(kind==='refresh')expect(summary.events.find(e=>e.type==='tool.allowed'&&e.data.id===callId)?.data.contractVersion).toBe(2);
  const requestId='requestId'in provider?provider.requestId:provider.state.planId!;
  const selection={...identity,subject:{kind:'main_run',runId:started.runId,toolCallIds:[callId]}},before=await records(),logs=await knowledgeContractLogBytes(f.user,entry.id),native=await fs.readFile(summary.sessionFile!),journalFile=path.join(f.user,entry.id,'transactions',requestId+'.json'),journalBytes=await fs.readFile(journalFile),current=(await workspace.snapshot()).revision;
  const observed=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',selection));expect(observed).toMatchObject({consistency:'stable',source:{state:'verified',scopeStatus:'closed'},calls:[{outcome:'failed',coverage:'knowledge_transaction',knowledge:{state:'committed',identity:{requestId},revision:current}}]});expect(JSON.stringify(observed)).not.toContain(data.marker);expect(JSON.stringify(observed)).not.toContain('PRIVATE_INVALID');
  const request={...selection,commandId:randomUUID(),expectedBasis:observed.basis,expectedRevision:observed.dispositionRevision,decision:'inspect_more',reason:'已核实原事务提交，原坏工具回复保留，后续另行核实当前知识'};
  const saved=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',request));expect(saved.record.observation.calls[0]).toMatchObject({outcome:'failed',knowledge:{state:'committed'}});
  const lookup={...identity,commandId:request.commandId};expect(await app.dispatch('dispatch.effectDispositionReceipt',lookup)).toEqual(saved);expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(saved);expect(commits).toHaveBeenCalledTimes(kind!=='object'?1:0);expect(planned).toHaveBeenCalledTimes(kind==='object'?1:0);expect(await fs.readFile(journalFile)).toEqual(journalBytes);expect(await knowledgeContractLogBytes(f.user,entry.id)).toEqual(logs);expect(await fs.readFile(summary.sessionFile!)).toEqual(native);
  const after=await records();expect(after.scopes).toEqual(before.scopes);expect(after.runs).toEqual(before.runs);const dispatchBytes=await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'));
  vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(app.workspace(entry.id).instanceId).not.toBe(provider.state.identity!.instanceId);
  const reopened=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',selection));expect(reopened.calls).toEqual(observed.calls);expect(reopened.basis).toBe(observed.basis);expect(await app.dispatch('dispatch.effectDispositionReceipt',lookup)).toEqual(saved);expect(await fs.readFile(path.join(f.user,entry.id,'dispatch','dispatch.jsonl'))).toEqual(dispatchBytes);expect(await fs.readFile(journalFile)).toEqual(journalBytes);expect(await knowledgeContractLogBytes(f.user,entry.id)).toEqual(logs);expect(await fs.readFile(summary.sessionFile!)).toEqual(native);expect(provider.requests).toHaveLength(requestCount);
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/refresh-effect-'+kind+'-pi-evidence.json',JSON.stringify({identity,runId:started.runId,requests:provider.requests.length,observation:observed,reopened,receipt:saved,originalJournalBytes:journalBytes.length,originalJournalHash:hash(journalBytes),nativeBytes:native.length,nativeHash:hash(native),originalCanonicalUnchanged:true,originalJournalUnchanged:true,reopenAddedRequests:0,errors:provider.errors},null,2));
 }finally{vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);
