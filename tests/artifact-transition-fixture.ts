import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {vi} from 'vitest';
import {manifestFixture,manifestContracts} from './output-manifest-fixture';
import {artifactBinding,invoke,seedProgress} from './artifact-runtime-fixture';
import {Win32ControlledFile} from '../src/backend/main/platform/files/controlled-file-win32';
import type {ArtifactTransitionRunPort} from '../src/backend/core/execution/capabilities/run-artifact-transition';
import type {ArtifactTransitionDefinition} from '../src/backend/core/workspace/artifact-scope';
import {preparedArtifactScopes} from '../src/backend/core/workspace/artifact-scope';
import {verifyOutputManifests} from '../src/backend/core/evidence/output-manifest-evidence';
import type {EngineContext} from '../src/backend/core/execution/types';

const native=createRequire(import.meta.url);
export const transitionTool='cbim_artifact_transition',transitionModule=manifestContracts[0].moduleId;
export const transitions:ArtifactTransitionDefinition[]=[{kind:'delete',path:'outputs/old.txt'},{kind:'move',from:'outputs/from.txt',to:'outputs/moved.txt'}];
export function transitionContracts(operations=transitions){const values=structuredClone(manifestContracts);values[0].contract.artifactScope!.transitions=structuredClone(operations);values[0].contract.delivery={requireCompleteManifest:true};return values}
export async function transitionFixture(work:Parameters<typeof manifestFixture>[0],options:Parameters<typeof manifestFixture>[1]&{operations?:ArtifactTransitionDefinition[];beforeApply?:()=>Promise<void>;afterApply?:()=>Promise<void>;afterOpen?:()=>Promise<void>}={}){
  const contracts=options.workflowContracts??transitionContracts(options.operations),scopes=preparedArtifactScopes(contracts),apply=vi.fn(),drain=vi.fn(async()=>{});
  const f=await manifestFixture(work,{workflowContracts:contracts,describeTool:call=>({effects:call.name==='read'?['read']:[transitionTool,'write'].includes(call.name)?['business-write']:['maintenance'],native:call.name==='read',contractVersion:1}),policy:async name=>({allow:true,effects:name==='read'?['read']:[transitionTool,'write'].includes(name)?['business-write']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}),transitionPort:directory=>({drain,withExclusive:async(operation,signal,use)=>{
    signal.throwIfAborted();const file=new Win32ControlledFile(directory,operation.kind==='delete'?operation.path:operation.from,[],native.resolve('koffi'),operation.kind==='delete'?{kind:'delete'}:{kind:'move',targetRelativePath:operation.to});
    try{await options.afterOpen?.();return await use({readBefore:async()=>file.read(),apply:async()=>{await options.beforeApply?.();signal.throwIfAborted();apply();const result=file.transition();await options.afterApply?.();return {identity:result.identity,fact:result.fact,operation,sourceMissing:true}}})}finally{file.close()}
  }} satisfies ArtifactTransitionRunPort),...options});
  await fs.writeFile(path.join(f.directory,'outputs','old.txt'),'remove this');await fs.writeFile(path.join(f.directory,'outputs','from.txt'),'\uFEFFmove unchanged\r\n');
  return {...f,contracts,scopes,apply,drain,verify:(events:Parameters<typeof verifyOutputManifests>[0])=>verifyOutputManifests(events,artifactBinding,'knowledge-one',scopes)};
}
export async function prepareTransition(c:EngineContext){await seedProgress(c);return (await invoke(c,'cbim_task_manifest_capture','before',{expectedTaskProgressVersion:1})).manifest.manifestId as string}
export function transitionInput(beforeManifestId:string,operationIndex=0,version=1){return {moduleId:transitionModule,operationIndex,beforeManifestId,expectedTaskProgressVersion:version}}
export async function runTransitions(c:EngineContext,count=2){let manifestId=await prepareTransition(c);for(let index=0;index<count;index++){await invoke(c,transitionTool,'transition-'+index,transitionInput(manifestId,index,index+1));manifestId=(await invoke(c,'cbim_task_manifest_capture','after-'+index,{expectedTaskProgressVersion:index+2})).manifest.manifestId}return manifestId}
export async function finishTransitions(c:EngineContext,manifestId:string,count=2){await invoke(c,'read','fresh-read',{path:'File.txt'});await invoke(c,'cbim_task_step','step',{expectedVersion:count+1,id:'verify',state:'reported_done',evidenceIds:['fresh-read']});return invoke(c,'cbim_delivery_prepare','delivery',{expectedVersion:count+2,manifestId,summary:'按原操作核实完整集合',limitations:[]})}
