import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import {humanDecisionPreviewSchema,humanDecisionReceiptSchema,humanDecisionHistorySchema,type HumanDecisionKind,type HumanDecisionRequest} from '../src/logic/tasks/rules/human-decisions';
import {humanDecisionProvider,humanDecisionFixture as data} from './human-decisions-provider';
import {seedHumanDecision,humanDecisionRecords,humanDecisionLogBytes} from './human-decisions-fixture';

async function ready(){
  const f=await fixture(),provider=await humanDecisionProvider();
  try{
    const {entry}=await seedHumanDecision(f.app,f.a,provider),start=await f.app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}) as {taskId:string;runId:string};
    const records=()=>humanDecisionRecords(f.user,entry.id);
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0]?.status).toBe('waiting')},{timeout:45000,interval:30});
    const saved=await records(),scope=saved.scopes[0],identity={workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId},graph=await f.app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:start.taskId}}),logs=await humanDecisionLogBytes(f.user,entry.id),sequence=[...provider.sequence];
    expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(7);expect(provider.state.baselineId).toBeTruthy();expect(scope.goal?.review?.decision).toBe('awaiting_user');expect(scope.wait).toBeTruthy();expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
    const preview=async(baselines:HumanDecisionRequest['baselines']=[])=>humanDecisionPreviewSchema.parse(await f.app.dispatch('dispatch.humanPreview',{...identity,criterionId:data.humanId,baselines}));
    const listed=await preview();expect(listed.decisionRevision).toBe(0);expect(listed.candidates).toHaveLength(1);expect(listed.candidates[0].selected).toBeUndefined();expect(listed.allowedDecisions).not.toContain('accept');expect(listed.candidates[0].baselines.map(item=>item.baselineId)).toContain(provider.state.baselineId);
    const candidate=listed.candidates[0],baselines=[{taskId:candidate.taskId,runId:candidate.runId,baselineId:provider.state.baselineId!}],verified=await preview(baselines);
    expect(verified.allowedDecisions).toEqual(expect.arrayContaining(['accept','reject','request_evidence']));expect(verified.candidates[0].selected?.files[0].state).toBe('matches');expect(verified.source?.criterion).toEqual({id:data.humanId,text:data.humanCriterion,kind:'human'});
    const unchanged=async(app=f.app)=>{const current=await records();expect(current.scopes.map(withoutHuman)).toEqual(saved.scopes.map(withoutHuman));expect(current.members).toEqual(saved.members);expect(current.messages).toEqual(saved.messages);expect(await app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:start.taskId}})).toEqual(graph);expect(await humanDecisionLogBytes(f.user,entry.id)).toEqual(logs);expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([])};
    return {f,provider,entry,identity,records,preview,baselines,verified,unchanged,sequence,cleanup:async()=>{await f.cleanup();await provider.close()}};
  }catch(error){await f.cleanup();await provider.close();throw error}
}
function withoutHuman(scope:DispatchScope){const copy=structuredClone(scope) as DispatchScope&{humanDecisions?:unknown};delete copy.humanDecisions;return copy}

it.each(['accept','reject','request_evidence'] as HumanDecisionKind[])('persists explicit %s against real Pi evidence without resuming or modifying source history',async decision=>{
  const c=await ready();let reopened:Application|undefined;
  try{
    const request:HumanDecisionRequest={...c.identity,criterionId:data.humanId,baselines:c.baselines,commandId:randomUUID(),expectedDecisionRevision:c.verified.decisionRevision,expectedBasis:c.verified.basis!,decision,comment:data.comment};
    const receipt=humanDecisionReceiptSchema.parse(await c.f.app.dispatch('dispatch.humanDecide',request));expect(receipt.scopeStatus).toBe('waiting');expect(receipt.decisionRevision).toBe(1);expect(receipt.record).toMatchObject({decisionId:request.commandId,decision,comment:data.comment,actor:{kind:'local_desktop',interaction:'explicit_submit'},basis:request.expectedBasis,baselines:c.baselines});expect(receipt.record.proof.source.criterion.kind).toBe('human');expect(receipt.record.proof.candidates[0].selected?.files[0].state).toBe('matches');
    expect(await c.f.app.dispatch('dispatch.humanDecide',request)).toEqual(receipt);expect(await c.f.app.dispatch('dispatch.humanReceipt',{...c.identity,commandId:request.commandId})).toEqual(receipt);await expect(c.f.app.dispatch('dispatch.humanDecide',{...request,comment:'不同内容不能沿原命令替换'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const history=humanDecisionHistorySchema.parse(await c.f.app.dispatch('dispatch.humanHistory',c.identity));expect(history.records).toEqual([receipt.record]);await c.unchanged();
    if(decision==='accept'){
      const preview=await c.preview(c.baselines);expect(preview.basis).toBe(c.verified.basis);expect(preview.decisionRevision).toBe(1);
      const next=humanDecisionReceiptSchema.parse(await c.f.app.dispatch('dispatch.humanDecide',{...request,commandId:randomUUID(),expectedDecisionRevision:1,decision:'reject',comment:'重新考虑同一依据，保留先前接受记录'}));expect(next.record.supersedesDecisionId).toBe(receipt.record.decisionId);expect(next.decisionRevision).toBe(2);await c.unchanged();
    }
    const saved=await c.records(),savedHistory=await c.f.app.dispatch('dispatch.humanHistory',c.identity);await c.f.app.shutdown();reopened=new Application(new Paths(c.f.user,path.resolve('.')),path.resolve('design'));await reopened.init();expect(await c.records()).toEqual(saved);expect(await reopened.dispatch('dispatch.humanHistory',c.identity)).toEqual(savedHistory);expect(humanDecisionReceiptSchema.parse(await reopened.dispatch('dispatch.humanReceipt',{...c.identity,commandId:request.commandId})).record).toEqual(receipt.record);await c.unchanged(reopened);
  }finally{if(reopened)await reopened.shutdown();await c.cleanup()}
},120000);

it('rejects stale file observations and allows an explicit rejection only after new preview',async()=>{
  const c=await ready();
  try{
    const request:HumanDecisionRequest={...c.identity,criterionId:data.humanId,baselines:c.baselines,commandId:randomUUID(),expectedDecisionRevision:0,expectedBasis:c.verified.basis!,decision:'accept',comment:data.comment};
    await fs.writeFile(path.join(c.f.a,data.file),data.changed);await expect(c.f.app.dispatch('dispatch.humanDecide',request)).rejects.toMatchObject({code:'HUMAN_STALE'});expect(await c.f.app.dispatch('dispatch.humanReceipt',{...c.identity,commandId:request.commandId})).toBeUndefined();expect(humanDecisionHistorySchema.parse(await c.f.app.dispatch('dispatch.humanHistory',c.identity)).records).toEqual([]);await c.unchanged();
    const changed=await c.preview(c.baselines);expect(changed.basis).not.toBe(c.verified.basis);expect(changed.allowedDecisions).not.toContain('accept');expect(changed.allowedDecisions).toContain('reject');expect(changed.candidates[0].selected?.files[0].state).toBe('changed');
    const result=humanDecisionReceiptSchema.parse(await c.f.app.dispatch('dispatch.humanDecide',{...request,commandId:randomUUID(),expectedBasis:changed.basis!,decision:'reject',comment:'已重新核实：文件变化，不接受当前成果'}));expect(result.record.proof.candidates[0].selected?.files[0].state).toBe('changed');expect(result.record.decision).toBe('reject');expect(result.scopeStatus).toBe('waiting');await c.unchanged();
  }finally{await c.cleanup()}
},120000);
