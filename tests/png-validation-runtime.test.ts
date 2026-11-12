import {RunValidation} from '../src/backend/core/execution/capabilities/run-validation';
import {runtimeToolGroup} from './runtime-tool-group';
import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {EngineContext,ToolDecision} from '../src/backend/core/execution';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import {validationTool} from '../src/backend/core/evidence/validation-tools';
import type {ValidationInput,ValidationResult} from '../src/backend/core/evidence/validation';
import {verifyValidationRecords} from '../src/backend/core/evidence/validation-evidence';
import {selectWorkflowValidations} from '../src/backend/core/evidence/workflow-evidence';
import {hash} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import {artifactRuntimeFixture,artifactBinding,seedProgress,invoke,captureInput,deferred} from './artifact-runtime-fixture';
import {rejected} from './complete-output-fixture';
import {pngValidationData as d} from './png-validation-data';

const contracts=(full=false):WorkflowContractBinding[]=>[{moduleId:'.cbim/workspace/module',workflowId:'png-flow',workflowVersion:'png-v1',contract:{version:1,...(full?{artifactScope:{version:1,roots:[{path:'File.txt',kind:'file'},{path:'outputs',kind:'directory'}]}}:{}),delivery:{requiredValidations:[{id:d.requirementId,validator:'png-raster-v1',artifactPath:'File.txt',schema:d.schema}],...(full?{requireCompleteManifest:true}:{})}}}];
const descriptor=(name:string)=>({effects:(['read','cbim_validation_run'].includes(name)?['read']:name==='write'?['business-write']:['maintenance']) as NonNullable<ToolDecision['effects']>,native:false,contractVersion:1});
async function fixture(work:(c:EngineContext)=>Promise<void>,full=false,options:Parameters<typeof artifactRuntimeFixture>[1]={}){const f=await artifactRuntimeFixture(work,{workflowContracts:contracts(full),describeTool:call=>validationTool(call.name,call.input)??descriptor(call.name),policy:async name=>({allow:true,...descriptor(name),scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}),...options});await fs.writeFile(path.join(f.directory,'File.txt'),Buffer.from(d.good,'base64'));if(full)await fs.mkdir(path.join(f.directory,'outputs'));return f}
async function prepare(c:EngineContext,full=false){await seedProgress(c);const captured=await invoke(c,full?'cbim_task_manifest_capture':'cbim_task_artifact_capture','capture',full?{expectedTaskProgressVersion:1}:captureInput);return {moduleId:contracts()[0].moduleId,requirementId:d.requirementId,expectedTaskProgressVersion:1,...(full?{manifestId:captured.manifest.manifestId}:{baselineId:captured.baseline.baselineId})}}
const step=(c:EngineContext)=>invoke(c,'cbim_task_step','step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['validation']});
const delivery=(input:ValidationInput)=>({expectedVersion:2,...(input.manifestId?{manifestId:input.manifestId}:{}),summary:'界面资源PNG真实检查通过',limitations:[]});

it.each([false,true])('真实PNG验证使用正确平台端口并绑定唯一原产物身份（完整集合=%s）',async full=>{
  const f=await fixture(async c=>{const input=await prepare(c,full),checked=await invoke(c,'cbim_validation_run','validation',input);expect(checked.validation.validator).toBe('png-raster-v1');expect(checked.validation.outcome).toBe('passed');await step(c);const result=await invoke(c,'cbim_delivery_prepare','delivery',delivery(input));expect(result.delivery.workflow.validationChecks[0].validator).toBe('png-raster-v1')},full);
  try{const summary=await(await f.start()).done;const records=verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',contracts(full),f.port.normalizePath);expect(summary.status).toBe('completed');expect(records).toHaveLength(1);expect(f.validateImage).toHaveBeenCalledTimes(1);expect(f.validateFile).not.toHaveBeenCalled();expect(records[0].result.artifact.sha256).toBe(hash(Buffer.from(d.good,'base64')));expect(records[0].result.manifest!==undefined).toBe(full);
    const forged=structuredClone(summary.events),event=forged.find(e=>e.type==='validation.checked')!,value=event.data.validation as ValidationResult;value.validator='json-schema-v1';const end=forged.find(e=>e.type==='tool.finished'&&e.data.id===value.toolCallId)!;end.data.result=jsonToolResult('cbim_validation_run',{state:'checked',validation:value});(end.data.receipt as any).resultHash=hash(JSON.stringify(end.data.result));expect(()=>verifyValidationRecords(forged,artifactBinding,'knowledge-one',contracts(full),f.port.normalizePath)).toThrow();
    const swapped=structuredClone(records);swapped[0].result.validator='json-schema-v1';expect(()=>selectWorkflowValidations(contracts(full),swapped.map(r=>r.receipt),artifactBinding,swapped)).toThrow();
  }finally{await f.cleanup()}
});
it('PNG像素尺寸不符合保留真实succeeded/rejected，不能满足指定出口',async()=>{
  const f=await fixture(async c=>{const result=await invoke(c,'cbim_validation_run','validation',await prepare(c));expect(result.validation.issues.map((i:any)=>i.code)).toEqual(['png_dimensions']);await step(c);await rejected(c,'cbim_delivery_prepare','delivery',{expectedVersion:2,summary:'不能交付',limitations:[]},'WORKFLOW_VALIDATION_REQUIRED')});
  try{await fs.writeFile(path.join(f.directory,'File.txt'),Buffer.from(d.bad,'base64'));const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(summary.taskProgress?.delivery).toBeUndefined();expect(verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',contracts(),f.port.normalizePath)[0]).toMatchObject({result:{outcome:'rejected',validator:'png-raster-v1'},receipt:{outcome:'succeeded'}})}finally{await f.cleanup()}
});
it.each(['before','after'] as const)('原PNG字节在%s验证时变化，不能保存旧通过或交付',async mode=>{
  const f=await fixture(async c=>{const input=await prepare(c);if(mode==='before'){await fs.writeFile(path.join(c.task.root,'File.txt'),Buffer.from(d.changed,'base64'));await rejected(c,'cbim_validation_run','validation',input,'VALIDATION_BASELINE_CHANGED')}else{await invoke(c,'cbim_validation_run','validation',input);await step(c);await fs.writeFile(path.join(c.task.root,'File.txt'),Buffer.from(d.changed,'base64'));await rejected(c,'cbim_delivery_prepare','delivery',delivery(input),'VALIDATION_ARTIFACT_CHANGED')}});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(summary.taskProgress?.delivery).toBeUndefined();expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(mode==='before'?0:1)}finally{await f.cleanup()}
});
it.each(['during','after'] as const)('PNG本身未变但完整目录新增，在%s检查窗口阻止出口',async mode=>{
  const f=await fixture(async c=>{const input=await prepare(c,true);if(mode==='during')await rejected(c,'cbim_validation_run','validation',input,'MANIFEST_OUTPUT_CHANGED');else{await invoke(c,'cbim_validation_run','validation',input);await step(c);await fs.writeFile(path.join(c.task.root,'outputs','extra.txt'),'added');await rejected(c,'cbim_delivery_prepare','delivery',delivery(input),'MANIFEST_OUTPUT_CHANGED')}},true);
  if(mode==='during')f.validateImage.mockImplementation(async(file,schema,signal)=>{const result=await f.filePort.validateImage(file,schema,signal);await fs.writeFile(path.join(f.directory,'outputs','extra.txt'),'added');return result});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(f.validateImage).toHaveBeenCalledTimes(1);expect(summary.taskProgress?.delivery).toBeUndefined();expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(mode==='during'?0:1);expect(await fs.readFile(path.join(f.directory,'File.txt'))).toEqual(Buffer.from(d.good,'base64'))}finally{await f.cleanup()}
});
it('真实PNG检查已保存但回包更换验证器，保留原事件且不能签发有效证明',async()=>{
  const f=await fixture(async c=>{const input=await prepare(c),port=RunValidation.prototype as unknown as {run(input:ValidationInput,id:string):Promise<ValidationResult>},run=port.run;const changed=vi.spyOn(port,'run').mockImplementationOnce(async function(this:typeof port,input,id){return {...await run.call(this,input,id),validator:'json-schema-v1' as const}});await rejected(c,'cbim_validation_run','validation',input,'TOOL_OUTPUT_INVALID');expect(changed).toHaveBeenCalledTimes(1);await invoke(c,'read','after-failure',{path:'File.txt'})});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(1);expect(verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',contracts(),f.port.normalizePath)).toEqual([]);expect(f.validateImage).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});
it('PNG缺少实际端口在模型启动前拒绝；读取期间停止取消，不保存通过',async()=>{
  const work=vi.fn(async()=>{}),missing=await fixture(work,false,{imageValidationPort:false});try{await expect(missing.start()).rejects.toMatchObject({code:'VALIDATION_UNAVAILABLE'});expect(work).not.toHaveBeenCalled()}finally{await missing.cleanup()}
  const entered=deferred(),release=deferred(),f=await fixture(async c=>{const input=await prepare(c);expect((await c.beforeTool({name:'cbim_validation_run',id:'validation',input})).allow).toBe(true);const pending=runtimeToolGroup(c,'validation')!.call('cbim_validation_run',input,'validation').catch(error=>error);await entered.promise;expect((await c.beforeTool({name:'write',id:'racing',input:{path:'File.txt',content:'bad'}})).allow).toBe(false);const error=await pending;expect(error.message).toContain('停止');await c.emit({type:'tool.finished',data:{name:'cbim_validation_run',id:'validation',isError:true,result:{content:[{type:'text',text:error.message}]}}})});
  f.validateImage.mockImplementation(async(_file,_schema,signal)=>{entered.resolve();await release.promise;expect(signal.aborted).toBe(true);signal.throwIfAborted();throw Error('停止信号缺失')});try{const run=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await run.done;expect(summary.status).toBe('cancelled');expect(summary.events.filter(e=>e.type==='validation.checked')).toHaveLength(0)}finally{release.resolve();await f.cleanup()}
});

afterEach(()=>vi.restoreAllMocks());
