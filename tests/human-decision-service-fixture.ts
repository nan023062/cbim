import {runtimeTools} from './runtime-tools-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,vi} from 'vitest';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {AgentEngine,EngineContext} from '../src/backend/core/brain/types';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {ArtifactFiles,normalizeArtifactPath} from '../src/backend/main/platform/artifact-files';
import {OutputManifestFiles} from '../src/backend/main/platform/output-manifest-files';
import type {HumanDecisionPreviewInput} from '../src/backend/core/tasks/human-decisions';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {MemberExecutionManager} from '../src/backend/scheduler-engine/execution/member-execution';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/execution/workspace-lease';
import {recheckDispatchExecutionContext} from '../src/backend/scheduler-engine/context/execution-context';
import {preparedWorkflowContracts} from '../src/backend/core/tasks/execution-context';
import {validationTool} from '../src/backend/core/tasks/validation-tools';
import {registerFixtureOwner} from './owner-execution-fixture';
import type {PreparedEngine} from '../src/backend/scheduler-engine/execution/member-execution';

export function latch(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}
export async function humanServiceFixture(options:{candidates?:number;command?:boolean;jsonValidation?:boolean;validationFiles?:number;completeManifest?:boolean}={}){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  const validationPaths=Array.from({length:options.validationFiles??1},(_,index)=>index?'human-validation-'+index+'.json':'human-0.txt');
  const validationWorkflow=options.jsonValidation||options.completeManifest?[{path:team.input.workflowId+'/workflow.md',text:'# 产物验收\n\n```cbim-workflow\n'+JSON.stringify({version:1,...(options.completeManifest?{artifactScope:{version:1,roots:[...validationPaths.map(path=>({path,kind:'file'})),{path:'human-output',kind:'directory'}]}}:{}),delivery:{...(options.completeManifest?{requireCompleteManifest:true}:{}),...(options.jsonValidation?{requiredValidations:validationPaths.map((artifactPath,index)=>({id:'json-'+index,validator:'json-schema-v1',artifactPath,schema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}}))}:{})}})+'\n```\n'}]:[];
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)},...validationWorkflow]));
  // 当前执行协议必须由显式登记的岗位负责；使用工作区唯一账本，让登记、派发和验收共享同一来源历史。
  const savedModel=await f.app.models.save({profile:{name:'人工验收测试岗位',api:'openai-completions',baseUrl:'https://example.test/v1',auth:'none',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false,vision:false}]}});
  const profileId=savedModel.profiles.find(item=>item.name==='人工验收测试岗位')!.id;
  await registerFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId,modelId:'fixture',name:'验收执行岗位',adaptation:{instructions:'读取本模块材料并提交验收证据。',references:[]}});
  const store=workspace.dispatchStore,directory=store.directory,memberLogs=path.join(f.user,'human-member-logs'),storage=new FileRunStorage(),files=new ArtifactFiles(f.a,()=>workspace.assert()),lease=new WorkspaceExecutionLease();
  const read=(run:DispatchRun)=>storage.read(path.join(memberLogs,run.binding.taskId,run.binding.runId)),inspect=vi.fn(read),checkFiles=vi.fn(files.checkFiles.bind(files));let retired=false,starts=0;
  const manifestFiles=new OutputManifestFiles(f.a,()=>workspace.assert()),checkManifest=vi.fn(manifestFiles.check.bind(manifestFiles));
  const identity={workspaceId:entry.id,rootSessionId:'human-root'},scopeId='human-scope',mainRunId='human-main',task={mode:'chat' as const,taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'人工验收真实候选',moduleIds:[],agentId:'cbim:main',acceptance:[]};
  const journal=new RunJournal(path.join(f.user,'human-main-log'),task,mainRunId),inspectMain=vi.fn((_root?:string,_runId?:string)=>RunJournal.read(journal.directory));
  const ports={normalizePath:(raw:string)=>normalizeArtifactPath(f.a,raw),checkFiles,checkManifest,acquireRead:()=>lease.acquire('human-'+randomUUID(),'read'),assertCurrent:()=>{if(retired)throw Object.assign(Error('已停止'),{code:'HUMAN_UNAVAILABLE'})}};
  const service=new WorkspaceDispatchService(workspace,store,{inspectMember:inspect,inspectMain,normalizeValidationPath:ports.normalizePath,checkValidationFiles:checkFiles,checkManifest},undefined,ports,f.app.models),binding=await service.conversationBinding(task);
  await journal.init();await journal.append({type:'run.started',data:{task,message:task.goal,conversationBinding:binding}});await journal.append({type:'session.bound',data:{sessionId:'human-main-native',sessionFile:path.join(f.user,'human-native.jsonl')}});
  await service.openScope(identity,scopeId,{message:task.goal},mainRunId);
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  await service.goals.plan(identity,scopeId,mainRunId,'human-plan',{expectedRevision:1,objective:'核实成果',constraints:[],criteria:[{id:'c1',text:'请人确认所选成果',kind:'human'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],criterionIds:['c1'],ownerSelection,reason:'执行后由人确认'}],reason:'明确人工项'});
  const model=await f.app.models.configuration(profileId,'fixture');
  const prepare=():PreparedEngine=>({model,availableTools:['read'],availableValidators:['json-schema-v1'],create:async(run,_task,hooks)=>{
    let context!:EngineContext;const engine:AgentEngine={kind:'human-service-fixture',start:async c=>{starts++;context=c;await c.emit({type:'session.bound',data:{sessionId:c.nativeSessionId,sessionFile:path.join(memberLogs,'native-'+c.nativeSessionId+'.jsonl')}})},stop:async()=>{},close:async()=>{},run:async()=>{
      let sequence=0;const invoke=async(name:string,input:Record<string,unknown>)=>{const id='tool-'+(++sequence),decision=await context.beforeTool({id,name,input});expect(decision.allow).toBe(true);const result=name==='read'?jsonToolResult('read',{text:await fs.readFile(path.join(f.a,String(input.path)),'utf8')}):name==='bash'?jsonToolResult('bash',{exitCode:0,text:'确定性单元命令回执'}):name==='cbim_task_manifest_capture'?await runtimeTools(context).manifestTools!.call(name,input,id):name==='cbim_task_artifact_capture'?await runtimeTools(context).artifactTools!.call(name,input,id):name==='cbim_validation_run'?await runtimeTools(context).validationTools!.call(name,input,id):await runtimeTools(context).taskTools!.call(name,input);await context.emit({type:'tool.finished',data:{id,name,result,isError:false}});return {id,body:JSON.parse(result.content[0].text)}};
      await invoke('cbim_task_plan',{expectedVersion:0,goal:context.task.goal,acceptance:context.task.acceptance,reason:'真实读取',steps:[{id:'verify',title:'核实文件',owner:'当前成员'}]});if(options.command)await invoke('bash',{command:'unit-fixture-success'});
      const version=options.command?2:1,source=await invoke('read',{path:context.task.goal}),sourceIds=[source.id];
      if(options.jsonValidation)for(const file of validationPaths.slice(1))sourceIds.push((await invoke('read',{path:file})).id);
      const base=await invoke('cbim_task_artifact_capture',{expectedTaskProgressVersion:version,sourceToolCallIds:sourceIds}),evidenceIds:string[]=[];
      const manifest=options.completeManifest?(await invoke('cbim_task_manifest_capture',{expectedTaskProgressVersion:version})).body.manifest:undefined;
      if(options.jsonValidation){for(let index=0;index<validationPaths.length;index++)evidenceIds.push((await invoke('cbim_validation_run',{moduleId,requirementId:'json-'+index,...(manifest?{manifestId:manifest.manifestId}:{baselineId:base.body.baseline.baselineId}),expectedTaskProgressVersion:version})).id);const note=await invoke('read',{path:'human-note.txt'});await invoke('cbim_task_artifact_capture',{expectedTaskProgressVersion:version,sourceToolCallIds:[note.id]})}else evidenceIds.push(source.id);
      await invoke('cbim_task_step',{expectedVersion:version,id:'verify',state:'reported_done',evidenceIds});await invoke('cbim_delivery_prepare',{expectedVersion:version+1,summary:'已读取 '+context.task.goal,limitations:[],...(manifest?{manifestId:manifest.manifestId}:{})});return {status:'completed'};
    }};
    return new LoopRuntime({storage,directory:memberLogs,createEngine:()=>engine,acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,artifacts:{knowledgeRevision:run.prepared.knowledgeRevision,normalizePath:ports.normalizePath,assertCurrentKnowledge:()=>recheckDispatchExecutionContext(workspace,run.prepared),captureFiles:(paths,signal)=>files.captureFiles(paths,signal)},manifests:{knowledgeRevision:run.prepared.knowledgeRevision,assertCurrentKnowledge:()=>recheckDispatchExecutionContext(workspace,run.prepared),capture:manifestFiles.capture.bind(manifestFiles)},...((options.jsonValidation||options.completeManifest)?{workflowContracts:preparedWorkflowContracts(run.prepared),validations:{validateFile:files.validateFile.bind(files),checkFiles},describeTool:(call:import('../src/backend/core/brain/types').ToolCall)=>({...validationTool(call.name,call.input),native:false,effects:[['read','cbim_validation_run'].includes(call.name)?'read' as const:'maintenance' as const],contractVersion:1})}:{}),toolPolicy:async call=>({allow:true,effects:[['read','cbim_validation_run'].includes(call.name)?'read':call.name==='bash'?'command':'maintenance'],scope:call.name==='bash'?{kind:'unknown',workspaceId:entry.id}:{kind:'workspace',workspaceId:entry.id}})});
  }});
  const members=new MemberExecutionManager(workspace,store,{inspect:read,artifacts:ports,manifests:{check:checkManifest,acquireRead:ports.acquireRead},acquire:(key,permission,agent)=>lease.acquire(key,permission,agent),owners:service.owners,prepare:async()=>prepare(),withEngineConfiguration:(reference,_options,use)=>f.app.models.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare}))});await members.initialize();
  for(let index=0;index<(options.candidates??1);index++){
    if(options.completeManifest){await fs.mkdir(path.join(f.a,'human-output','empty'),{recursive:true});await fs.writeFile(path.join(f.a,'human-output','result.txt'),'complete result')}
    const filename='human-'+index+'.txt';await fs.writeFile(path.join(f.a,filename),options.jsonValidation?'{"count":1}':'original '+index);if(options.jsonValidation){await fs.writeFile(path.join(f.a,'human-note.txt'),'review notes');for(const file of validationPaths.slice(1))await fs.writeFile(path.join(f.a,file),'{"count":1}')}
    const assigned=await service.dispatchTask({...identity,commandId:'assign-'+index,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:filename,acceptance:[{id:'c1',text:'有真实读取'}]}},scopeId);
    await members.start({...identity,taskId:assigned.taskId,commandId:'start-'+index,expectedRevision:1,options:{permission:'execute'}});await members.waitForSettlement({...identity,taskId:assigned.taskId});
  }
  const graph=await service.snapshot(identity);expect(graph.tasks.every(task=>task.status==='result_ready'),JSON.stringify({tasks:graph.tasks,runs:(await store.read()).runs})).toBe(true);
  await service.goals.review(identity,scopeId,mainRunId,'human-review',{expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'needs_human',reason:'请确认成果',evidence:graph.tasks.map(task=>({kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.planRevision,toolCallIds:task.result!.evidenceRefs}))}],superseded:[],gaps:['等待人的明确意见'],reason:'请人确认'});
  await journal.append({type:'run.settled',data:{status:'completed'}});await service.parkScope(identity,scopeId,await inspectMain(),[mainRunId]);
  const input:HumanDecisionPreviewInput={...identity,scopeId,criterionId:'c1',baselines:[]},menu=await service.humanDecisions.preview(input);
  expect(menu.allowedDecisions,JSON.stringify(menu.issues)).toEqual(['reject','request_evidence']);if(options.completeManifest)input.manifests=menu.candidates.map(candidate=>({taskId:candidate.taskId,runId:candidate.runId,manifestId:candidate.manifest!.manifestId}));else input.baselines=menu.candidates.map(candidate=>({taskId:candidate.taskId,runId:candidate.runId,baselineId:candidate.baselines[0].baselineId}));
  const preview=()=>service.humanDecisions.preview(input),actor={kind:'local_desktop' as const,interaction:'explicit_submit' as const};
  return {...f,entry,workspace,directory,memberLogs,store,storage,files,lease,service,members,journal,inspect,inspectMain,checkFiles,checkManifest,manifestFiles,read,input,identity,scopeId,mainRunId,actor,ports,preview,setRetired:()=>{retired=true},get starts(){return starts},cleanup:async()=>{await members.close();await store.close();await f.cleanup()}};
}
