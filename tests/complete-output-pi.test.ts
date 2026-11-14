import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {humanDecisionPreviewSchema,humanDecisionReceiptSchema} from '../src/logic/tasks/rules/human-decisions';
import {completeOutputProvider,completeOutputData as d} from './complete-output-provider';
import {seedCompleteOutput,completeOutputRecords,completeOutputSourceBytes} from './complete-output-pi-fixture';

it.each(['automatic','changed','human'] as const)('真实 Pi 完整交付、集合变化阻断及人工接受后重新核实（%s）',async mode=>{
  const f=await fixture(),provider=await completeOutputProvider(mode);let reopened:Application|undefined;
  try{
    const {entry,profileId}=await seedCompleteOutput(f.app,f.a,provider),start=await f.app.dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}})as{taskId:string},identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>completeOutputRecords(f.user,entry.id),extra=path.join(f.a,d.root,'extra.txt');
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.readyForReview).toBe(true)},{timeout:60000,interval:40});expect(provider.member).toHaveLength(8);expect(provider.state.manifest.entryCount).toBe(3);expect(provider.state.delivery.delivery.workflow.validationChecks[0].manifest).toEqual(provider.state.validation.manifest);expect(provider.state.validation.manifest.manifestId).toBe(provider.state.manifest.manifestId);
    if(mode==='changed')await fs.writeFile(extra,'new file outside old JSON');provider.releaseReview();
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe(mode==='human'?'waiting':'closed')},{timeout:60000,interval:40});
    if(mode==='human'){
      const scope=(await records()).scopes[0],input={...identity,scopeId:scope.scopeId,criterionId:d.humanId,baselines:[]},menu=humanDecisionPreviewSchema.parse(await f.app.dispatch('dispatch.humanPreview',input));expect(menu.candidates[0].baselines).toEqual([]);expect(menu.candidates[0].selectedManifest).toBeUndefined();
      const candidate=menu.candidates[0],manifests=[{taskId:candidate.taskId,runId:candidate.runId,manifestId:candidate.manifest!.manifestId}],selected={...input,manifests},preview=humanDecisionPreviewSchema.parse(await f.app.dispatch('dispatch.humanPreview',selected)),saved=humanDecisionReceiptSchema.parse(await f.app.dispatch('dispatch.humanDecide',{...selected,commandId:randomUUID(),expectedDecisionRevision:preview.decisionRevision,expectedBasis:preview.basis,decision:'accept',comment:'明确接受完整目录及全部后代'}));
      const request={...identity,scopeId:scope.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:saved.decisionRevision,commandId:randomUUID(),decisionIds:[saved.record.decisionId],options:{provider:'cbim-'+profileId,profileId,model:d.model,permission:'execute',turnTimeoutMs:60000}},before=await records(),bytes=await completeOutputSourceBytes(f.user,entry.id),sequence=[...provider.sequence];
      await fs.writeFile(extra,'changed after acceptance');await expect(f.app.dispatch('loop.humanContinue',request)).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});expect(await records()).toEqual(before);expect(await completeOutputSourceBytes(f.user,entry.id)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);
      await f.app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();expect(await records()).toEqual(before);expect(provider.sequence).toEqual(sequence);await expect(reopened.dispatch('loop.humanContinue',request)).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});
      await fs.unlink(extra);await reopened.dispatch('loop.humanContinue',request);await vi.waitFor(()=>expect(provider.main).toHaveLength(7),{timeout:60000});provider.releaseContinuation();await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed')},{timeout:60000,interval:40});expect(await completeOutputSourceBytes(f.user,entry.id)).toMatchObject(bytes);expect(provider.main).toHaveLength(11);expect((await records()).scopes[0].humanDecisions?.records[0]).toEqual(saved.record);
    }
    const settled=await records();expect(settled.scopes[0].outcome).toBe(mode==='changed'?'failed':'completed');expect(provider.member).toHaveLength(8);expect(provider.main).toHaveLength(mode==='human'?11:mode==='changed'?7:6);expect(provider.errors).toEqual([]);expect(await fs.readFile(path.join(f.a,d.file),'utf8')).toBe(d.content);
  }finally{provider.releaseAll();await reopened?.shutdown();await f.cleanup();await provider.close()}
},180000);
