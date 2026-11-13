import {RunValidation} from '../src/logic/execution/rules/capabilities/run-validation';
import type {ValidationInput,ValidationResult} from '../src/logic/evidence/rules/validation';
import {runtimeToolGroup} from './runtime-tool-group';
import {afterEach,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {completeFixture,completeContracts,prepareComplete,completeStep,rejected,delivery} from './complete-output-fixture';
import {artifactBinding,invoke,deferred,seedProgress,captureInput} from './artifact-runtime-fixture';
import {verifyManifests,manifestContracts} from './output-manifest-fixture';
import {completeOutputProof} from '../src/logic/evidence/rules/complete-output-evidence';
import {verifyValidationRecords} from '../src/logic/evidence/rules/validation-evidence';
import {validateWorkflowEvidence} from '../src/logic/evidence/rules/workflow-evidence';
import {workflowContractSchema} from '../src/logic/workspace/rules/workflow-contract';

it('完整出口必须声明范围，显式选择原清单并让 JSON/候选/历史重算共享身份',async()=>{
  expect(workflowContractSchema.safeParse({version:1,delivery:{requireCompleteManifest:true}}).success).toBe(false);
  const f=await completeFixture(async c=>{const id=await prepareComplete(c);await completeStep(c);const result=await invoke(c,'cbim_delivery_prepare','delivery',delivery(id));expect(result.delivery.workflow.manifest.manifestId).toBe(id);expect(result.delivery.workflow.validationChecks[0].manifest.manifestId).toBe(id)});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');const manifest=verifyManifests(summary.events).records[0],records=verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',completeContracts(),f.port.normalizePath),proof=completeOutputProof(manifest);expect(validateWorkflowEvidence(summary.events,f.task,completeContracts(),records,proof)).toEqual(summary.taskProgress?.delivery?.workflow);expect(f.captureManifest).toHaveBeenCalledTimes(4);expect(records[0].result.baselineId).toBeUndefined();expect(f.validateFile).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});
it.each(['before-json','during-json','after-json'] as const)('未变 JSON 之外增加文件阻止 %s 窗口的完整出口',async mode=>{
  const f=await completeFixture(async c=>{
    await seedProgress(c);const id=(await invoke(c,'cbim_task_manifest_capture','capture',{expectedTaskProgressVersion:1})).manifest.manifestId;
    if(mode==='before-json')await fs.writeFile(path.join(c.task.root,'outputs','extra.txt'),'added');
    const args={moduleId:manifestContracts[0].moduleId,requirementId:'json',manifestId:id,expectedTaskProgressVersion:1};
    if(mode!=='after-json')await rejected(c,'cbim_validation_run','validation',args,'MANIFEST_OUTPUT_CHANGED');else{await invoke(c,'cbim_validation_run','validation',args);await completeStep(c);await fs.writeFile(path.join(c.task.root,'outputs','extra.txt'),'added');await rejected(c,'cbim_delivery_prepare','delivery',delivery(id),'MANIFEST_OUTPUT_CHANGED')}
  });
  if(mode==='during-json')f.validateFile.mockImplementation(async(file,schema,signal)=>{const value=await f.filePort.validateFile(file,schema,signal);await fs.writeFile(path.join(f.directory,'outputs','extra.txt'),'added');return value});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(summary.taskProgress?.delivery).toBeUndefined();expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(mode==='after-json'?1:0);expect(await fs.readFile(path.join(f.directory,'File.txt'),'utf8')).toBe('{"count":1}')}finally{await f.cleanup()}
});
it('完整模式不能退回文件基线或混用另一份相同字节清单，省略选择也不自动取最新',async()=>{
  const f=await completeFixture(async c=>{
    await seedProgress(c);const base=await invoke(c,'cbim_task_artifact_capture','baseline',captureInput);
    await rejected(c,'cbim_validation_run','legacy-validation',{moduleId:manifestContracts[0].moduleId,requirementId:'json',baselineId:base.baseline.baselineId,expectedTaskProgressVersion:1});
    const first=(await invoke(c,'cbim_task_manifest_capture','first',{expectedTaskProgressVersion:1})).manifest;
    await invoke(c,'cbim_validation_run','validation',{moduleId:manifestContracts[0].moduleId,requirementId:'json',manifestId:first.manifestId,expectedTaskProgressVersion:1});
    const second=(await invoke(c,'cbim_task_manifest_capture','second',{expectedTaskProgressVersion:1})).manifest;expect(first.manifestHash).toBe(second.manifestHash);await completeStep(c);
    await rejected(c,'cbim_delivery_prepare','mixed',delivery(second.manifestId),'MANIFEST_VALIDATION_MISMATCH');
    const {manifestId:_,...missing}=delivery(first.manifestId);await rejected(c,'cbim_delivery_prepare','missing',missing,'MANIFEST_REQUIRED');
    await invoke(c,'cbim_delivery_prepare','original',delivery(first.manifestId));
  });try{expect((await(await f.start()).done).taskProgress?.delivery?.workflow?.manifest?.captureToolCallId).toBe('first')}finally{await f.cleanup()}
});
it('缺失输出根不能满足正常完整交付；纯完整模式仍必须重读全部范围',async()=>{
  const f=await completeFixture(async c=>{await seedProgress(c);await fs.rename(path.join(c.task.root,'outputs'),path.join(c.task.root,'moved'));const id=(await invoke(c,'cbim_task_manifest_capture','capture',{expectedTaskProgressVersion:1})).manifest.manifestId;await completeStep(c,false);await rejected(c,'cbim_delivery_prepare','delivery',delivery(id),'MANIFEST_OUTPUT_MISSING')},{},false);
  try{const summary=await(await f.start()).done;expect(summary.taskProgress?.delivery).toBeUndefined();expect(f.captureManifest).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});
it('交付门闩覆盖审批、全集合读取及候选落盘后的全部窗口，真正结束才释放',async()=>{
  const entered=deferred(),release=deferred(),f=await completeFixture(async c=>{
    const id=await prepareComplete(c,false);await completeStep(c,false);const args=delivery(id);expect((await c.beforeTool({name:'cbim_delivery_prepare',id:'delivery',input:args})).allow).toBe(true);const pending=runtimeToolGroup(c,'task-progress')!.call('cbim_delivery_prepare',args);await entered.promise;
    for(const name of ['read','write','cbim_task_manifest_capture','cbim_task_help'])expect((await c.beforeTool({name,id:'racing-'+name,input:{}})).allow).toBe(false);
    release.resolve();const result=await pending;expect((await c.beforeTool({name:'read',id:'before-finish',input:{path:'File.txt'}})).allow).toBe(false);await c.emit({type:'tool.finished',data:{name:'cbim_delivery_prepare',id:'delivery',result}});await invoke(c,'read','after',{path:'File.txt'});
  },{afterAppend:async event=>{if(event.type==='task.updated'&&(event.data.progress as {state?:string}).state==='awaiting_review'){entered.resolve();await release.promise}}},false);
  try{expect((await(await f.start()).done).taskProgress?.state).toBe('awaiting_review')}finally{release.resolve();await f.cleanup()}
});
it('交付读取中停止保留原采集及验证，不能保存新候选',async()=>{
  const entered=deferred(),release=deferred(),f=await completeFixture(async c=>{const id=await prepareComplete(c,false);await completeStep(c,false);const error=await rejected(c,'cbim_delivery_prepare','delivery',delivery(id));expect(error.message).toContain('停止')},{},false);
  const original=f.captureManifest.getMockImplementation()!;f.captureManifest.mockImplementationOnce(original).mockImplementationOnce(async(scopes,signal)=>{entered.resolve();await release.promise;signal.throwIfAborted();return original(scopes,signal)});
  try{const handle=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await handle.done;expect(summary.status).toBe('cancelled');expect(summary.taskProgress?.delivery).toBeUndefined();expect(verifyManifests(summary.events).records).toHaveLength(1)}finally{release.resolve();await f.cleanup()}
});
it('JSON真实检查已保存后坏wire不能换绑完整哈希，也不重新执行检查',async()=>{
  const f=await completeFixture(async c=>{const id=await prepareComplete(c,false),port=RunValidation.prototype as unknown as {run(input:ValidationInput,id:string):Promise<ValidationResult>},run=port.run;const changed=vi.spyOn(port,'run').mockImplementationOnce(async function(this:typeof port,input,call){const value=await run.call(this,input,call);return {...value,manifest:{...value.manifest!,manifestHash:'f'.repeat(64)}}});await rejected(c,'cbim_validation_run','validation',{moduleId:manifestContracts[0].moduleId,requirementId:'json',manifestId:id,expectedTaskProgressVersion:1},'TOOL_OUTPUT_INVALID');expect(changed).toHaveBeenCalledTimes(1);await invoke(c,'read','after-failure',{path:'File.txt'})});
  try{const summary=await(await f.start()).done;expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(1);expect(verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',completeContracts(),f.port.normalizePath)).toEqual([]);expect(f.validateFile).toHaveBeenCalledTimes(1);expect(summary.taskProgress?.delivery).toBeUndefined()}finally{await f.cleanup()}
});

afterEach(()=>vi.restoreAllMocks());
