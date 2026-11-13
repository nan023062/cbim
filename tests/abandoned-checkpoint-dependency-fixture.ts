import assert from 'node:assert/strict';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {ReplaceQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-replacement';
import {abandonedDependencyData as data} from './abandoned-checkpoint-dependency-provider';
export {seedDependencyReplacement as seedAbandonedDependency,dependencyRuns as abandonedRuns} from './queued-dependency-replacement-fixture';
export {additionRecords as abandonedRecords} from './queued-dependency-addition-fixture';
export {revisionWait as abandonedWait,revisionRunBytes as abandonedRunBytes,revisionRunByteEvidence as abandonedRunByteEvidence} from './queued-dependency-revision-pi-fixture';

/** Inspect real snapshots; inherited seed uses the same actual file names/bytes and explicit owner registration. */
export function assertAbandonedDependency(graph:GraphSnapshot,initial:GraphSnapshot,before:GraphSnapshot,receipt:ReplaceQueuedDependencyReceipt,executed:boolean){
  assert.equal(graph.tasks.length,4);const [a,b,c,a2]=data.goals.map(goal=>graph.tasks.find(t=>t.goal===goal)!);assert.ok([a,b,c,a2].every(Boolean));
  assert.deepEqual(a,before.tasks.find(t=>t.taskId===a.taskId));assert.equal(a.status,'cancelled');assert.ok(a.checkpointAbandonment);assert.equal(a.runIds.length,1);assert.deepEqual(a.checkpoints,initial.tasks.find(t=>t.taskId===a.taskId)!.checkpoints);assert.ok(a2.result);
  for(const t of [b,c]){const old=initial.tasks.find(v=>v.taskId===t.taskId)!;assert.ok(old);for(const k of ['assignee','ownerBinding','planRevision','modules','workflowSelections','goal','acceptance']as const)assert.deepEqual(t[k],old[k]);assert.equal(t.runIds.length,executed?1:0)}
  assert.deepEqual(b.dependencyReplacements,[receipt.replacement]);assert.equal(c.dependencyReplacements,undefined);assert.deepEqual(receipt.trackedTaskIds,[b.taskId,c.taskId]);
  const retired=graph.edges.find(e=>e.edgeId===receipt.replacement.retired.edgeId),fresh=graph.edges.find(e=>e.edgeId===receipt.replacement.replacement.edgeId);assert.ok(retired&&fresh?.kind==='dependency');assert.equal(retired.enabled,false);assert.equal(retired.fromNodeId,a.nodeId);assert.equal(retired.toNodeId,b.nodeId);assert.equal(fresh.enabled,true);assert.equal(fresh.fromNodeId,a2.nodeId);assert.equal(fresh.toNodeId,b.nodeId);assert.deepEqual(fresh.condition,{kind:'result_ready',reviewRequired:true,planRevision:a2.planRevision,resultId:a2.result.resultId});assert.equal(receipt.replacement.reason,data.reason);
  if(executed){assert.equal(b.status,'result_ready');assert.equal(c.status,'result_ready');assert.ok(b.result&&c.result)}return {a,b,c,a2};
}
