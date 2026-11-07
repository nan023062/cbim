import type {Application} from '../src/backend/main/application';
import type {HumanDecisionKind} from '../src/backend/core/tasks/human-decisions';
import {humanDecisionPreviewSchema,humanDecisionReceiptSchema} from '../src/backend/core/tasks/human-decisions';
import type {HumanContinuationRequest} from '../src/backend/core/tasks/human-continue';
import {randomUUID} from 'node:crypto';
import {humanDecisionLogBytes,humanDecisionRecords} from './human-decisions-fixture';
import {humanContinuationFixture as data} from './human-continuation-provider';
export {seedHumanDecision as seedHumanContinuation,humanDecisionRecords as humanContinuationRecords} from './human-decisions-fixture';

/** Explicit fixture-side desktop decision, using real preview and selected member baseline. */
export async function decideHumanContinuation(app:Application,user:string,workspaceId:string,decision:HumanDecisionKind){
  const scope=(await humanDecisionRecords(user,workspaceId)).scopes[0],identity={workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId};
  const listed=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',{...identity,criterionId:data.humanId,baselines:[]})),candidate=listed.candidates[0];
  if(!candidate?.baselines[0])throw Error('真实候选缺少人工可选基线');
  const baselines=[{taskId:candidate.taskId,runId:candidate.runId,baselineId:candidate.baselines[0].baselineId}],preview=humanDecisionPreviewSchema.parse(await app.dispatch('dispatch.humanPreview',{...identity,criterionId:data.humanId,baselines}));
  return humanDecisionReceiptSchema.parse(await app.dispatch('dispatch.humanDecide',{...identity,criterionId:data.humanId,baselines,commandId:randomUUID(),expectedDecisionRevision:preview.decisionRevision,expectedBasis:preview.basis,decision,comment:'明确'+decision+'此候选；继续仍须另外点击。'}));
}

/** Build only the new strict no-message protocol from a current durable waiting scope. */
export async function humanContinuationRequest(app:Application,user:string,workspaceId:string):Promise<HumanContinuationRequest>{
  const scope=(await humanDecisionRecords(user,workspaceId)).scopes[0],profileId=(await app.models.list()).selectedId!;
  if(!scope.wait||!scope.goal||!scope.humanDecisions)throw Error('真实waiting/人工决定尚未齐备');
  const latest=new Map<string,string>();for(const record of scope.humanDecisions.records)if(record.proof.source.waitId===scope.wait.waitId)latest.set(record.criterionId,record.decisionId);
  return {workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,waitId:scope.wait.waitId,expectedGoalRevision:scope.goal.revision,expectedInputRevision:scope.goal.inputRevision??1,expectedDecisionRevision:scope.humanDecisions.revision,commandId:randomUUID(),decisionIds:[...latest.values()],options:{provider:'cbim-'+profileId,profileId,model:data.model,permission:'execute',turnTimeoutMs:60000}};
}

/** Original canonical and member-native history must remain immutable; main native legitimately appends on continuation. */
export async function humanContinuationSourceBytes(user:string,workspaceId:string){return Object.fromEntries(Object.entries(await humanDecisionLogBytes(user,workspaceId)).filter(([file])=>file.endsWith('events.jsonl')||file.startsWith('dispatch/runs/')||file.startsWith('dispatch\\runs\\')))}
