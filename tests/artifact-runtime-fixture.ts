import {runtimeToolGroup} from './runtime-tool-group';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {vi} from 'vitest';
import {LoopRuntime,type AgentEngine,type EngineContext,type EngineEvent,type TaskSpec,type ToolDecision} from '../src/backend/core/brain';
import {ArtifactFiles,normalizeArtifactPath} from '../src/backend/main/platform/artifact-files';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {ArtifactCapturePort} from '../src/backend/core/brain/artifact-capture';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {RuntimeOptions} from '../src/backend/core/brain/runtime';
import type {ValidationFilePort} from '../src/backend/core/brain/run-validation';
import {OutputManifestFiles} from '../src/backend/main/platform/output-manifest-files';
import type {OutputManifestCapturePort} from '../src/backend/core/brain/output-manifest-capture';
import type {ArtifactTransitionRunPort} from '../src/backend/core/brain/run-artifact-transition';

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
export async function artifactRuntimeFixture(work:(context:EngineContext)=>Promise<void>,options:{port?:false;manifestPort?:false;validationPort?:false;tableValidationPort?:false;imageValidationPort?:false;transitionPort?:(directory:string)=>ArtifactTransitionRunPort;policy?:(name:string)=>Promise<ToolDecision>;nativeCheck?:()=>Promise<void>;resumeInputs?:()=>Promise<void>;afterAppend?:(event:EngineEvent)=>Promise<void>;workflowContracts?:RuntimeOptions['workflowContracts'];describeTool?:RuntimeOptions['describeTool']}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-artifact-runtime-'));await fs.writeFile(path.join(directory,'File.txt'),'actual bytes');let context!:EngineContext;
  const filePort=new ArtifactFiles(directory,()=>{}),knowledge=vi.fn(async()=>{}),captureFiles=vi.fn<ArtifactCapturePort['captureFiles']>((files,signal)=>filePort.captureFiles(files,signal));
  const port:ArtifactCapturePort={knowledgeRevision:'knowledge-one',normalizePath:raw=>normalizeArtifactPath(directory,raw),assertCurrentKnowledge:knowledge,captureFiles};
  const manifestFiles=new OutputManifestFiles(directory,()=>{}),captureManifest=vi.fn<OutputManifestCapturePort['capture']>((scopes,signal)=>manifestFiles.capture(scopes,signal));
  const validateFile=vi.fn<ValidationFilePort['validateFile']>((file,schema,signal)=>filePort.validateFile(file,schema,signal)),checkValidationFiles=vi.fn<ValidationFilePort['checkFiles']>((files,signal)=>filePort.checkFiles(files,signal));
  const validateImage=vi.fn<NonNullable<ValidationFilePort['validateImage']>>((file,schema,signal)=>filePort.validateImage(file,schema,signal));
  const validateTable=vi.fn<NonNullable<ValidationFilePort['validateTable']>>((file,schema,signal)=>filePort.validateTable(file,schema,signal));
  const engine:AgentEngine={kind:'artifact-fixture',start:async value=>{context=value;await value.emit({type:'session.bound',data:{sessionId:value.nativeSessionId,sessionFile:path.join(directory,'native.jsonl')}})},run:async()=>{await work(context);return {status:'completed'}},stop:async()=>{},close:async()=>{}};
  const storage=new FileRunStorage(),create=storage.createJournal.bind(storage);
  if(options.afterAppend)storage.createJournal=(...args)=>{const journal=create(...args),append=journal.append.bind(journal);journal.append=async event=>{const saved=await append(event);await options.afterAppend!(event);return saved};return journal};
  const runtime=new LoopRuntime({storage,directory,workflowContracts:options.workflowContracts,describeTool:options.describeTool,artifactTransitions:options.transitionPort?.(directory),artifacts:options.port===false?undefined:port,manifests:options.manifestPort===false?undefined:{knowledgeRevision:port.knowledgeRevision,assertCurrentKnowledge:knowledge,capture:captureManifest},validations:options.validationPort===false?undefined:{validateFile,validateTable:options.tableValidationPort===false?undefined:validateTable,validateImage:options.imageValidationPort===false?undefined:validateImage,checkFiles:checkValidationFiles},assertMemberResume:options.nativeCheck,assertMemberResumeInputs:options.resumeInputs??(options.nativeCheck?async()=>{}:undefined),acquireLease:async()=>()=>{},createEngine:()=>engine,toolPolicy:async call=>options.policy?options.policy(call.name):({allow:true,effects:call.name==='read'?['read']:call.name==='write'?['business-write']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}})});
  const task:TaskSpec={taskId:artifactBinding.taskId,workspaceId:artifactBinding.workspaceId,root:directory,agentId:artifactBinding.agentId,goal:'核实业务文件',moduleIds:['.cbim/workspace/module'],acceptance:['真实文件证据']};
  return {directory,task,runtime,port,filePort,manifestFiles,captureManifest,knowledge,captureFiles,validateFile,validateTable,validateImage,checkValidationFiles,start:()=>runtime.startMember(task,task.goal,{binding:artifactBinding,session:{nativeSessionId:'native-one'}}),cleanup:async()=>{await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-artifact-runtime-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}};
}
