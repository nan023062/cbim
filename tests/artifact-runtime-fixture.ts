import {runtimeToolGroup} from './runtime-tool-group';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {vi} from 'vitest';
import {LoopRuntime,type AgentEngine,type EngineContext,type EngineEvent,type TaskSpec,type ToolDecision} from '../src/logic/execution/rules';
import {ArtifactFiles,normalizeArtifactPath} from '../src/logic/file-operations/platform/files/artifact-files';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {ArtifactCapturePort} from '../src/logic/execution/rules/capabilities/artifact-capture';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import type {RuntimeOptions} from '../src/logic/execution/rules/runtime/runtime';
import type {ValidationFilePort} from '../src/logic/execution/rules/capabilities/run-validation';
import {OutputManifestFiles} from '../src/logic/file-operations/platform/files/output-manifest-files';
import type {OutputManifestCapturePort} from '../src/logic/execution/rules/capabilities/output-manifest-capture';
import type {ArtifactTransitionRunPort} from '../src/logic/execution/rules/capabilities/run-artifact-transition';

export const artifactBinding={workspaceId:'workspace-one',teamId:'.cbim/team',agentId:'cbim:executor',agentInstanceId:'member-one',agentSessionId:'channel-one',rootSessionId:'root-session',taskId:'task-one',runId:'run-one',leaseEpoch:1,planRevision:1};
export const captureInput={expectedTaskProgressVersion:1,sourceToolCallIds:['source-read']};
export function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
export async function invoke(c:EngineContext,name:string,id:string,input:Record<string,unknown>){
  const decision=await c.beforeTool({name,id,input});if(!decision.allow)throw Error(decision.reason??'拒绝');
  const result=name==='cbim_artifact_transition'?await runtimeToolGroup(c,'artifact-transitions')!.call(name,input,id):name.startsWith('cbim_task_manifest_')?await runtimeToolGroup(c,'manifests')!.call(name,input,id):name==='cbim_validation_run'?await runtimeToolGroup(c,'validation')!.call(name,input,id):name==='cbim_task_artifact_capture'?await runtimeToolGroup(c,'artifacts')!.call(name,input,id):name==='read'?jsonToolResult('read',{text:await fs.readFile(path.join(c.task.root,String(input.path)),'utf8')}):await runtimeToolGroup(c,'task-progress')!.call(name,input);
  await c.emit({type:'tool.finished',data:{name,id,result,isError:false}});return JSON.parse(result.content[0].text);
}
export async function seedProgress(c:EngineContext){
  await invoke(c,'cbim_task_plan','plan',{expectedVersion:0,goal:c.task.goal,acceptance:c.task.acceptance,reason:'核实文件',steps:[{id:'verify',title:'检查',owner:'当前成员'}]});
  await invoke(c,'read','source-read',{path:'File.txt'});
}
export async function artifactRuntimeFixture(work:(context:EngineContext)=>Promise<void>,options:{codeChecks?:RuntimeOptions['codeChecks'];port?:false;manifestPort?:false;validationPort?:false;tableValidationPort?:false;imageValidationPort?:false;transitionPort?:(directory:string)=>ArtifactTransitionRunPort;policy?:(name:string)=>Promise<ToolDecision>;nativeCheck?:()=>Promise<void>;resumeInputs?:()=>Promise<void>;afterAppend?:(event:EngineEvent)=>Promise<void>;workflowContracts?:RuntimeOptions['workflowContracts'];describeTool?:RuntimeOptions['DescribeTool']}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-artifact-runtime-'));await fs.writeFile(path.join(directory,'File.txt'),'actual bytes');let context!:EngineContext;
  const filePort=new ArtifactFiles(directory,()=>{}),knowledge=vi.fn(async()=>{}),captureFiles=vi.fn<ArtifactCapturePort['CaptureFiles']>((files,signal)=>filePort.CaptureFiles(files,signal));
  const port:ArtifactCapturePort={knowledgeRevision:'knowledge-one',NormalizePath:raw=>normalizeArtifactPath(directory,raw),AssertCurrentKnowledge:knowledge,CaptureFiles: captureFiles};
  const manifestFiles=new OutputManifestFiles(directory,()=>{}),captureManifest=vi.fn<OutputManifestCapturePort['Capture']>((scopes,signal)=>manifestFiles.Capture(scopes,signal));
  const validateFile=vi.fn<ValidationFilePort['ValidateFile']>((file,schema,signal)=>filePort.ValidateFile(file,schema,signal)),checkValidationFiles=vi.fn<ValidationFilePort['CheckFiles']>((files,signal)=>filePort.CheckFiles(files,signal));
  const validateImage=vi.fn<NonNullable<ValidationFilePort['ValidateImage']>>((file,schema,signal)=>filePort.ValidateImage(file,schema,signal));
  const validateTable=vi.fn<NonNullable<ValidationFilePort['ValidateTable']>>((file,schema,signal)=>filePort.ValidateTable(file,schema,signal));
  const engine:AgentEngine={kind:'artifact-fixture',start:async value=>{context=value;await value.emit({type:'session.bound',data:{sessionId:value.nativeSessionId,sessionFile:path.join(directory,'native.jsonl')}})},run:async()=>{await work(context);return {status:'completed'}},stop:async()=>{},close:async()=>{}};
  const storage=new FileRunStorage(),create=storage.CreateJournal.bind(storage);
  if(options.afterAppend)storage.CreateJournal=(...args)=>{const journal=create(...args),append=journal.Append.bind(journal);journal.Append=async event=>{const saved=await append(event);await options.afterAppend!(event);return saved};return journal};
  const runtime=new LoopRuntime({codeChecks:options.codeChecks,storage,directory,workflowContracts:options.workflowContracts,DescribeTool:options.describeTool,artifactTransitions:options.transitionPort?.(directory),artifacts:options.port===false?undefined:port,manifests:options.manifestPort===false?undefined:{knowledgeRevision:port.knowledgeRevision,AssertCurrentKnowledge:knowledge,Capture:captureManifest},validations:options.validationPort===false?undefined:{ValidateFile: validateFile,ValidateTable:options.tableValidationPort===false?undefined:validateTable,ValidateImage:options.imageValidationPort===false?undefined:validateImage,CheckFiles:checkValidationFiles},AssertMemberResume:options.nativeCheck,AssertMemberResumeInputs:options.resumeInputs??(options.nativeCheck?async()=>{}:undefined),AcquireLease:async()=>()=>{},CreateEngine:()=>engine,ToolPolicy:async call=>options.policy?options.policy(call.name):({allow:true,effects:call.name==='read'?['read']:call.name==='write'?['business-write']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}})});
  const task:TaskSpec={taskId:artifactBinding.taskId,workspaceId:artifactBinding.workspaceId,root:directory,agentId:artifactBinding.agentId,goal:'核实业务文件',moduleIds:['.cbim/workspace/module'],acceptance:['真实文件证据']};
  return {directory,task,runtime,port,filePort,manifestFiles,captureManifest,knowledge,captureFiles,validateFile,validateTable,validateImage,checkValidationFiles,start:()=>runtime.StartMember(task,task.goal,{binding:artifactBinding,session:{nativeSessionId:'native-one'}}),cleanup:async()=>{await runtime.Close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-artifact-runtime-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}};
}
