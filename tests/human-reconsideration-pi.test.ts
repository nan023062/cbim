import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {humanDecisionPreviewSchema,humanDecisionReceiptSchema} from '../src/backend/core/tasks/human-decisions';
import {completeOutputProvider,completeOutputData as d} from './complete-output-provider';
import {seedCompleteOutput,completeOutputRecords,completeOutputSourceBytes} from './complete-output-pi-fixture';

it('真实 Pi 两次等待：旧接受不可继承，集合/原日志变化明确阻断，重开后新决定独立继续',async()=>{
  const f=await fixture(),provider=await completeOutputProvider('human',false,true);let reopened:Application|undefined,app=f.app;
  try{
    const {entry,profileId}=await seedCompleteOutput(app,f.a,provider),start=await app.dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}})as{taskId:string},identity={workspaceId:entry.id,rootSessionId:start.taskId},records=()=>completeOutputRecords(f.user,entry.id);
    const wait=async(count:number)=>vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect(provider.main).toHaveLength(count);expect((await records()).scopes[0].status).toBe('waiting')},{timeout:60000,interval:40});
    provider.releaseReview();await wait(6);const firstScope=(await records()).scopes[0],base={...identity,scopeId:firstScope.scopeId,criterionId:d.humanId,baselines:[]};
    const menu=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',base)),candidate=menu.candidates[0],selected={...base,manifests:[{taskId:candidate.taskId,runId:candidate.runId,manifestId:candidate.manifest!.manifestId}]};
    const save=async(input:typeof selected&{reconsidersDecisionId?:string})=>{const p=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',input));return humanDecisionReceiptSchema.parse(await app.dispatch('dispatch.humanDecide',{...input,commandId:randomUUID(),expectedDecisionRevision:p.decisionRevision,expectedBasis:p.basis,decision:'accept',comment:'按当前明确选择重新核实'}))};
    const request=async(id:string)=>{const scope=(await records()).scopes[0];return {...identity,scopeId:scope.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,expectedDecisionRevision:scope.humanDecisions!.revision,commandId:randomUUID(),decisionIds:[id],options:{provider:'cbim-'+profileId,profileId,model:d.model,permission:'execute',turnTimeoutMs:60000}}};
    const prior=await save(selected),originalBytes=await completeOutputSourceBytes(f.user,entry.id);provider.releaseContinuation();await app.dispatch('loop.humanContinue',await request(prior.record.decisionId));await wait(11);
    const second=await records(),source=await completeOutputSourceBytes(f.user,entry.id),sequence=[...provider.sequence];expect(second.scopes[0].wait?.waitId).not.toBe(firstScope.wait?.waitId);expect(second.scopes[0].humanDecisions?.records).toEqual([prior.record]);expect(source).toMatchObject(originalBytes);
    await expect(app.dispatch('loop.humanContinue',await request(prior.record.decisionId))).rejects.toMatchObject({code:'HUMAN_CONTINUATION_STALE'});
    const input={...selected,reconsidersDecisionId:prior.record.decisionId},initial=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',{...input,manifests:[]}));expect(initial.reconsideration).toMatchObject({status:'unverifiable',canReconsider:true});expect(initial.candidates[0].selectedManifest).toBeUndefined();
    const matches=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',input));expect(matches.reconsideration).toMatchObject({status:'evidence_matches',canReconsider:true});
    const extra=path.join(f.a,d.root,'extra.txt');await fs.writeFile(extra,'new external file');const changed=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',input));expect(changed.reconsideration?.status).toBe('changed');expect(changed.allowedDecisions).not.toContain('accept');await fs.unlink(extra);
    const [relative,bytes]=Object.entries(source).find(([file,bytes])=>file.endsWith('events.jsonl')&&JSON.parse(bytes.split('\n')[0]).runId===prior.record.proof.source.reviewRunId)!;const canonical=path.join(f.user,entry.id,relative);await fs.appendFile(canonical,'{"partial":');const broken=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',input));expect(broken.reconsideration).toMatchObject({status:'unverifiable',canReconsider:false});expect(broken.allowedDecisions).toEqual([]);await fs.writeFile(canonical,bytes);
    expect(await records()).toEqual(second);expect(provider.sequence).toEqual(sequence);expect(await completeOutputSourceBytes(f.user,entry.id)).toEqual(source);
    await app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();app=reopened;expect(await records()).toEqual(second);expect(provider.sequence).toEqual(sequence);
    const current=await save(input);expect(current.record.reconsidersDecisionId).toBe(prior.record.decisionId);expect(current.record.proof.source.waitId).toBe(second.scopes[0].wait?.waitId);expect(current.record.decisionId).not.toBe(prior.record.decisionId);expect(provider.sequence).toEqual(sequence);
    await app.dispatch('loop.humanContinue',await request(current.record.decisionId));await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].outcome).toBe('completed')},{timeout:60000,interval:40});
    expect(provider.main).toHaveLength(16);expect(provider.member).toHaveLength(8);expect((await records()).scopes[0].humanDecisions?.records).toEqual([prior.record,current.record]);expect(await completeOutputSourceBytes(f.user,entry.id)).toMatchObject(source);expect(await fs.readFile(path.join(f.a,d.file),'utf8')).toBe(d.content);
  }finally{provider.releaseAll();await reopened?.shutdown();await f.cleanup();await provider.close()}
},180000);
