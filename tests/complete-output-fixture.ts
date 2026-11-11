import {runtimeToolGroup} from './runtime-tool-group';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {EngineContext} from '../src/backend/core/brain/types';
import {validationTool} from '../src/backend/core/tasks/validation-tools';
import {manifestFixture,manifestContracts} from './output-manifest-fixture';
import {artifactBinding,seedProgress,invoke} from './artifact-runtime-fixture';

export function completeContracts(json=true){const values=structuredClone(manifestContracts);values[0].contract.delivery={requireCompleteManifest:true,...(json?{requiredValidations:[{id:'json',validator:'json-schema-v1' as const,artifactPath:'File.txt',schema:{type:'object' as const,properties:{count:{type:'integer' as const}},required:['count'],additionalProperties:false}}]}:{})};return values}
export async function completeFixture(work:Parameters<typeof manifestFixture>[0],options:Parameters<typeof manifestFixture>[1]={},json=true){
  const f=await manifestFixture(work,{workflowContracts:completeContracts(json),describeTool:call=>({...validationTool(call.name,call.input),native:false,effects:['read','cbim_validation_run'].includes(call.name)?['read']:call.name==='write'?['business-write']:['maintenance'],contractVersion:1}),policy:async name=>({allow:true,effects:['read','cbim_validation_run'].includes(name)?['read']:name==='write'?['business-write']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}),...options});
  await fs.writeFile(path.join(f.directory,'File.txt'),'{"count":1}');return f;
}
export async function prepareComplete(c:EngineContext,json=true){await seedProgress(c);const captured=await invoke(c,'cbim_task_manifest_capture','capture',{expectedTaskProgressVersion:1}),manifestId=captured.manifest.manifestId as string;if(json)await invoke(c,'cbim_validation_run','validation',{moduleId:manifestContracts[0].moduleId,requirementId:'json',manifestId,expectedTaskProgressVersion:1});return manifestId}
export async function completeStep(c:EngineContext,json=true){await invoke(c,'cbim_task_step','step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[json?'validation':'source-read']})}
export async function rejected(c:EngineContext,name:string,id:string,input:Record<string,unknown>,code?:string){const decision=await c.beforeTool({name,id,input});if(!decision.allow)throw Error('Unexpected denied: '+decision.reason);const result=await (name==='cbim_validation_run'?runtimeToolGroup(c,'validation')!.call(name,input,id):runtimeToolGroup(c,'task-progress')!.call(name,input)).then(()=>{throw Error('Unexpected success')},error=>error);if(code&&result.code!==code)throw Error('Expected '+code+', got '+result.code+': '+result.message);await c.emit({type:'tool.finished',data:{name,id,isError:true,result:{content:[{type:'text',text:String(result.message)}]}}});return result}
export const delivery=(manifestId:string)=>({expectedVersion:2,manifestId,summary:'完整范围当前匹配',limitations:[]});
