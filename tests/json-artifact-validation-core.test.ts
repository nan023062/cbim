import {describe,it,expect,vi} from 'vitest';
import {boundedJsonSchemaSchema,validateJsonArtifact,jsonValidationLimits,type BoundedJsonSchema} from '../src/logic/workspace/rules/json-validation-schema';
import {workflowContractSchema,parseWorkflowContract} from '../src/logic/workspace/rules/workflow-contract';
import {validationInputSchema,validationResultSchema,validationToolName,type ValidationResult,type ValidationRecord} from '../src/logic/evidence/rules/validation';
import {ValidationTools} from '../src/logic/evidence/rules/validation-tools';
import {verifyValidationRecords,validationRequirement} from '../src/logic/evidence/rules/validation-evidence';
import {artifactSources,type ArtifactEvidenceEvent} from '../src/logic/evidence/rules/artifact-evidence';
import type {ArtifactBaselineStaged} from '../src/logic/evidence/rules/artifact-baseline';
import {evaluateWorkflowDelivery,selectWorkflowValidations} from '../src/logic/evidence/rules/workflow-evidence';
import {TaskProgressTools} from '../src/logic/evidence/rules/progress-tools';
import type {WorkflowContractBinding} from '../src/logic/tasks/rules/execution-context';
import type {TaskProgress} from '../src/logic/evidence/rules/progress';
import {hash} from '../src/core/platform/node/serialization';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import type {ToolReceipt} from '../src/logic/tools/rules/types';
const bytes=(text:string)=>new TextEncoder().encode(text),stamp='2026-11-07T00:00:00.000Z';
const identity={workspaceId:'workspace',taskId:'task',runId:'run'},binding={...identity,teamId:'team',agentId:'agent',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',leaseEpoch:1,planRevision:1};
const schema:BoundedJsonSchema={type:'object',required:['name','count'],properties:{name:{type:'string',minLength:1},count:{type:'integer',minimum:1}},additionalProperties:false};
const requirement={id:'shape',validator:'json-schema-v1' as const,artifactPath:'result.json',schema};
const bindings:WorkflowContractBinding[]=[{moduleId:'module',workflowId:'workflow',workflowVersion:'frozen-body',contract:{version:1,delivery:{requiredValidations:[requirement]}}}];
const input={moduleId:'module',requirementId:'shape',baselineId:'baseline',expectedTaskProgressVersion:1};
const normalize=(path:string)=>path.replace(/^\/workspace\//,'');
function emit(events:ArtifactEvidenceEvent[],type:string,data:Record<string,unknown>){const event={...identity,type,seq:(events.at(-1)?.seq??0)+1,data};events.push(event);return event}
function start(events:ArtifactEvidenceEvent[],id:string,name:string,input:Record<string,unknown>,effects:ToolReceipt['effects']=['read']){emit(events,'tool.proposed',{id,name,input});return emit(events,'tool.allowed',{id,name,input,effects,scope:{kind:'workspace',workspaceId:identity.workspaceId}})}
function finish(events:ArtifactEvidenceEvent[],allowed:ArtifactEvidenceEvent,result:unknown,outcome:ToolReceipt['outcome']='succeeded'){
  const d=allowed.data,receipt:ToolReceipt={version:1,...identity,toolCallId:String(d.id),toolName:String(d.name),outcome,inputHash:hash(JSON.stringify(d.input)),resultHash:hash(JSON.stringify(result)),effects:d.effects as ToolReceipt['effects'],scope:d.scope as ToolReceipt['scope'],recordedAt:stamp};return emit(events,'tool.finished',{id:d.id,name:d.name,result,receipt,isError:outcome==='failed'});
}
function setup(text='{"name":"成果","count":1}'){
  const events:ArtifactEvidenceEvent[]=[];emit(events,'run.started',{memberBinding:binding,task:{...identity,agentId:binding.agentId}});emit(events,'task.updated',{progress:{version:1}});
  finish(events,start(events,'read-source','read',{path:'/workspace/result.json'}),jsonToolResult('read',{text}));
  const capture=start(events,'capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:1,sourceToolCallIds:['read-source']},['maintenance']),sources=artifactSources(events,binding,['read-source']);
  const baseline:ArtifactBaselineStaged={version:1,baselineId:'baseline',captureToolCallId:'capture',binding,knowledgeRevision:'knowledge',progressVersion:1,capturedAt:stamp,lastEffectSeq:0,sourceCalls:sources.sources.map(({path:_,...rest})=>rest),files:[{relativePath:'result.json',byteLength:bytes(text).length,sha256:hash(Buffer.from(bytes(text))),sourceToolCallIds:['read-source']}]};
  emit(events,'artifact.baseline_captured',{baseline});finish(events,capture,jsonToolResult('cbim_task_artifact_capture',{state:'captured',baseline}));return {events,baseline,text};
}
function validate(f:ReturnType<typeof setup>,version=1,callId='validation'){
  const allowed=start(f.events,callId,validationToolName,{...input,expectedTaskProgressVersion:version}),selected=validationRequirement(bindings,'module','shape');
  const result:ValidationResult={version:1,validationId:callId,toolCallId:callId,binding,validator:'json-schema-v1',requirement:{moduleId:'module',workflowId:'workflow',workflowVersion:'frozen-body',requirementId:'shape',schemaHash:selected.schemaHash},knowledgeRevision:'knowledge',taskProgressVersion:version,baselineId:'baseline',artifact:{relativePath:f.baseline.files[0].relativePath,byteLength:f.baseline.files[0].byteLength,sha256:f.baseline.files[0].sha256},lastEffectSeq:0,checkedAt:stamp,...validateJsonArtifact(schema,bytes(f.text))};
  emit(f.events,'validation.checked',{validation:result});finish(f.events,allowed,jsonToolResult(validationToolName,{state:'checked',validation:result}));return result;
}
const verify=(events:ArtifactEvidenceEvent[])=>verifyValidationRecords(events,binding,'knowledge',bindings,normalize);
function resign(events:ArtifactEvidenceEvent[]){const result=events.find(event=>event.type==='validation.checked')!.data.validation as ValidationResult,end=events.find(event=>event.type==='tool.finished'&&event.data.name===validationToolName)!;end.data.result=jsonToolResult(validationToolName,{state:'checked',validation:result});(end.data.receipt as ToolReceipt).resultHash=hash(JSON.stringify(end.data.result))}

describe('bounded JSON validation declarations and data',()=>{
  it('supports objects, arrays, Unicode lengths and primitives without conversion',()=>{
    expect(validateJsonArtifact(schema,bytes('{"name":"x","count":1}'))).toEqual({outcome:'passed',issues:[]});expect(validateJsonArtifact(schema,bytes('{"name":"x","count":"1"}')).outcome).toBe('rejected');
    expect(validateJsonArtifact({type:'array',minItems:1,maxItems:2,items:{type:'string',minLength:1,maxLength:1}},bytes('["😀"]')).outcome).toBe('passed');
    for(const [s,text] of [[{type:'boolean',const:true},'false'],[{type:'number',minimum:1,maximum:3},'4'],[{type:'string',enum:['yes']},'"no"'],[{type:'null'},'true']] as const)expect(validateJsonArtifact(s as BoundedJsonSchema,bytes(text)).outcome).toBe('rejected');
  });
  it('rejects refs/regex/formats/scripts/combinations and inapplicable or unsupported keywords',()=>{
    for(const patch of [{$ref:'https://private/schema'},{$ref:'#/$defs/x'},{$dynamicRef:'#x'},{pattern:'.*'},{format:'email'},{allOf:[]},{code:'process.exit()'},{default:'x'},{type:['object','null']},{minimum:1},{enum:[{}]}])expect(boundedJsonSchemaSchema.safeParse({...schema,...patch}).success).toBe(false);
    expect(boundedJsonSchemaSchema.safeParse({type:'object',properties:{__proto__:{type:'string'}}}).success).toBe(false);
    expect(()=>validateJsonArtifact({...schema,$ref:'https://invalid'} as any,bytes('{}'))).toThrow(expect.objectContaining({code:'VALIDATION_SCHEMA_INVALID'}));
  });
  it('bounds schema depth/text and preserves legal special property names without prototype lookup',()=>{
    let deep:BoundedJsonSchema={type:'string'};for(let i=0;i<jsonValidationLimits.schemaDepth;i++)deep={type:'array',items:deep};expect(boundedJsonSchemaSchema.safeParse(deep).success).toBe(false);
    const declared=JSON.parse('{"type":"object","required":["__proto__"],"properties":{"__proto__":{"type":"string"}},"additionalProperties":false}');expect(boundedJsonSchemaSchema.safeParse(declared).success).toBe(true);expect(validateJsonArtifact(declared,bytes('{"__proto__":"literal"}')).outcome).toBe('passed');
    expect(boundedJsonSchemaSchema.safeParse({type:'string',enum:['x'.repeat(4097)]}).success).toBe(false);
  });
  it('rejects malformed UTF8, duplicate/comment/nonfinite/deep JSON without leaking content and never truncates oversized bytes',()=>{
    for(const data of [new Uint8Array([0xff]),bytes('{"secret":1,"secret":2}'),bytes('{/*private*/}'),bytes('1e999'),bytes('['.repeat(65)+'0'+']'.repeat(65))])expect(validateJsonArtifact(schema,data)).toEqual({outcome:'rejected',issues:[{code:'json_invalid',instancePath:''}]});
    const result=validateJsonArtifact(schema,bytes('{"name":"x","count":1,"private-unknown-key":"private-value"}'));expect(JSON.stringify(result)).not.toContain('private');expect(result.issues[0].keyword).toBe('additionalProperties');expect(()=>validateJsonArtifact(schema,new Uint8Array(jsonValidationLimits.fileBytes+1))).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));
  });
  it('supports validation-only requirements, rejects empty/colliding or unsafe declarations, and keeps legacy proof unchanged',()=>{
    expect(workflowContractSchema.safeParse(bindings[0].contract).success).toBe(true);expect(parseWorkflowContract('```cbim-workflow\n'+JSON.stringify(bindings[0].contract)+'\n```')).toEqual(bindings[0].contract);
    for(const artifactPath of ['../other','/absolute','x/.cbim/secret','x\\out','x:stream'])expect(workflowContractSchema.safeParse({version:1,delivery:{requiredValidations:[{...requirement,artifactPath}]}}).success).toBe(false);
    expect(workflowContractSchema.safeParse({version:1,delivery:{}}).success).toBe(false);expect(workflowContractSchema.safeParse({version:1,delivery:{requiredValidations:[requirement],requiredToolEvidence:[{id:'shape',toolName:'read'}]}}).success).toBe(false);expect(evaluateWorkflowDelivery([{...bindings[0],contract:{version:1,beforeEffects:{requirePlan:true}}}],[],identity)).not.toHaveProperty('validationChecks');
  });
});
describe('canonical validation records and strict output',()=>{
  it('derives succeeded/passed and succeeded/rejected from matching baseline, call and event',()=>{
    for(const [text,outcome] of [['{"name":"x","count":1}','passed'],['{"name":"x","count":"bad"}','rejected']] as const){const f=setup(text),result=validate(f),before=structuredClone(f.events),records=verify(f.events);expect(records).toHaveLength(1);expect(records[0]).toMatchObject({result:{outcome},receipt:{outcome:'succeeded'}});expect(records[0].result).toEqual(result);expect(f.events).toEqual(before)}
  });
  it('allows step versions but invalidates a capture after plan revision or a side effect',()=>{
    const f=setup();emit(f.events,'task.updated',{progress:{version:2}});validate(f,2);expect(verify(f.events)).toHaveLength(1);emit(f.events,'task.updated',{progress:{version:3}});expect(verify(f.events)).toHaveLength(1);
    for(const name of ['write','cbim_task_plan']){const bad=setup();finish(bad.events,start(bad.events,'change',name,name==='write'?{path:'result.json',content:'new'}:{expectedVersion:1},[name==='write'?'business-write':'maintenance']),jsonToolResult(name,{ok:true}));validate(bad);expect(()=>verify(bad.events)).toThrow()}
  });
  it('rejects cross-run/member/schema/module/file, changed body and absent/duplicate canonical events',()=>{
    const alterations:Array<(events:ArtifactEvidenceEvent[])=>void>=[e=>{e.at(-1)!.runId='other'},e=>{const v=e.find(x=>x.type==='validation.checked')!.data.validation as ValidationResult;v.binding={...binding,agentSessionId:'other'};resign(e)},e=>{(e.find(x=>x.type==='validation.checked')!.data.validation as ValidationResult).requirement.schemaHash=hash('wrong');resign(e)},e=>{(e.find(x=>x.type==='validation.checked')!.data.validation as ValidationResult).artifact.sha256=hash('wrong');resign(e)},e=>{(e.find(x=>x.type==='validation.checked')!.data.validation as ValidationResult).requirement.moduleId='other';resign(e)},e=>{e.at(-1)!.data.result={secret:'forged'}},e=>{e.splice(e.findIndex(x=>x.type==='validation.checked'),1)},e=>{emit(e,'validation.checked',e.find(x=>x.type==='validation.checked')!.data)}];
    for(const alter of alterations){const f=setup();validate(f);alter(f.events);expect(()=>verify(f.events)).toThrow()}
  });
  it('does not certify staged/failed output or windows containing stop/plan/other calls',()=>{
    const f=setup();validate(f);f.events.pop();expect(verify(f.events)).toEqual([]);const failed=setup();validate(failed);(failed.events.at(-1)!.data.receipt as ToolReceipt).outcome='failed';expect(verify(failed.events)).toEqual([]);
    for(const type of ['run.stop_requested','task.updated','tool.allowed']){const bad=setup();validate(bad);const end=bad.events.pop()!;emit(bad.events,type,{id:'other',progress:{version:2}});bad.events.push({...end,seq:bad.events.at(-1)!.seq+1});expect(()=>verify(bad.events)).toThrow()}
    const pending=setup();start(pending.events,'unfinished','write',{path:'result.json',content:'x'},['business-write']);validate(pending);expect(()=>verify(pending.events)).toThrow();
  });
  it('rejects model-supplied authority and drifted wire after one saved result without replay',async()=>{
    const f=setup(),result=validate(f),saved:ValidationResult[]=[],run=vi.fn(async()=>{saved.push(structuredClone(result));return {...result,requirement:{...result.requirement,schemaHash:hash('forged')}}}),tools=new ValidationTools(binding,{knowledgeRevision:'knowledge',bindings,run});
    for(const patch of [{schema},{path:'secret'},{passed:true},{runId:'other'}]){expect(validationInputSchema.safeParse({...input,...patch}).success).toBe(false);await expect(tools.call(validationToolName,{...input,...patch},'validation')).rejects.toThrow()}expect(run).not.toHaveBeenCalled();
    await expect(tools.call(validationToolName,input,'validation')).rejects.toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));expect(run).toHaveBeenCalledTimes(1);expect(saved).toEqual([result]);
    const safe=new ValidationTools(binding,{knowledgeRevision:'knowledge',bindings,run:async()=>result});expect(JSON.parse((await safe.call(validationToolName,input,'validation')).content[0].text)).toEqual({state:'checked',validation:result});expect(validationResultSchema.safeParse({...result,outcome:'rejected',issues:[]}).success).toBe(false);
  });
});
describe('precise Workflow and Progress exit',()=>{
  const plan={expectedVersion:0,goal:'目标',acceptance:['验收'],reason:'计划',steps:[{id:'s',title:'实际校验',owner:'成员'}]};
  it('keeps rejected checks as step facts but refuses delivery',async()=>{
    const f=setup('{"name":"x","count":"bad"}');validate(f);const records=verify(f.events),save=vi.fn(async()=>{}),verifyCurrent=vi.fn(async()=>{}),tools=new TaskProgressTools(undefined,save,{identity,workflow:{bindings,identity,task:{goal:'目标',acceptance:['验收']}},validations:{records:()=>records,verifyCurrent}});
    await tools.call('cbim_task_plan',plan);tools.record(records[0].receipt,tools.generation);await tools.call('cbim_task_step',{expectedVersion:1,id:'s',state:'reported_done',evidenceIds:['validation']});expect(JSON.parse((await tools.call('cbim_task_inspect',{})).content[0].text).validations[0].outcome).toBe('rejected');
    await expect(tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'完成',limitations:[]})).rejects.toThrow(expect.objectContaining({code:'WORKFLOW_VALIDATION_REQUIRED'}));expect(verifyCurrent).not.toHaveBeenCalled();expect(save).toHaveBeenCalledTimes(2);
  });
  it('only uses explicitly cited passed result, rechecks current bytes, and preserves exact proof',async()=>{
    const f=setup();validate(f);const records=verify(f.events),saved:TaskProgress[]=[],verifyCurrent=vi.fn(async(_records:readonly ValidationRecord[])=>{}),tools=new TaskProgressTools(undefined,async p=>{saved.push(structuredClone(p))},{identity,workflow:{bindings,identity,task:{goal:'目标',acceptance:['验收']}},validations:{records:()=>records,verifyCurrent}});
    expect(()=>selectWorkflowValidations(bindings,[],identity,records)).toThrow();expect(()=>selectWorkflowValidations(bindings,[records[0].receipt],{...identity,runId:'old'},records)).toThrow();
    await tools.call('cbim_task_plan',plan);tools.record(records[0].receipt,tools.generation);await tools.call('cbim_task_step',{expectedVersion:1,id:'s',state:'reported_done',evidenceIds:['validation']});await tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'候选',limitations:[]});expect(verifyCurrent).toHaveBeenCalledWith(records);expect(saved.at(-1)?.delivery?.workflow?.validationChecks).toEqual([{...records[0].result.requirement,validator:'json-schema-v1',validationId:'validation',toolCallId:'validation',baselineId:'baseline',artifact:records[0].result.artifact}]);
    verifyCurrent.mockRejectedValueOnce(Object.assign(Error('字节变化'),{code:'VALIDATION_ARTIFACT_CHANGED'}));await expect(tools.call('cbim_delivery_prepare',{expectedVersion:3,summary:'再次候选',limitations:[]})).rejects.toThrow('字节变化');expect(saved).toHaveLength(3);
  });
});
