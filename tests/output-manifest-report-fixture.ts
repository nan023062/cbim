import {vi} from 'vitest';
import {manifestFixture,manifestInput,manifestContracts} from './output-manifest-fixture';
import {seedProgress,invoke,artifactBinding} from './artifact-runtime-fixture';
import {OutputManifestReportService} from '../src/logic/evidence/runtime/output-manifest-report-service';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {OutputManifestSnapshot,OutputManifestStaged} from '../src/logic/evidence/rules/output-manifest';

export async function manifestReportFixture(){
  const f=await manifestFixture(async c=>{await seedProgress(c);await invoke(c,'cbim_task_manifest_capture','capture',manifestInput)}),summary=await (await f.start()).done;
  if(summary.status!=='completed')throw Error('manifest fixture did not complete: '+JSON.stringify(summary.events.at(-1)));
  const manifest=summary.events.find(e=>e.type==='artifact.manifest_captured')!.data.manifest as OutputManifestStaged;
  const identity={workspaceId:artifactBinding.workspaceId,rootSessionId:artifactBinding.rootSessionId},agent={agentId:artifactBinding.agentId,agentInstanceId:artifactBinding.agentInstanceId,agentSessionId:artifactBinding.agentSessionId,name:'执行者'};
  const state={workspaceId:identity.workspaceId,members:[],sessions:[],outbox:[],scopes:[],runs:[{binding:artifactBinding,status:'completed',prepared:{knowledgeRevision:'knowledge-one',modules:manifestContracts.map(c=>({binding:{moduleId:c.moduleId,workflow:{id:c.workflowId,version:c.workflowVersion}},workflowContract:c.contract}))},session:{nativeSessionId:'native-one',sessionFile:summary.sessionFile}}],graphs:[{version:1,identity,cursor:{...identity,streamId:'stream',seq:5},root:{agent},edges:[],agents:[],tasks:[{kind:'task',identity,taskId:artifactBinding.taskId,nodeId:'task:'+artifactBinding.taskId,requester:agent,assignee:agent,modules:f.task.moduleIds.map(moduleId=>({moduleId})),goal:f.task.goal,acceptance:f.task.acceptance.map((text,index)=>({id:'criterion-'+index,text})),status:'blocked',revision:3,planRevision:1,runIds:[artifactBinding.runId],awaitedChildren:[],createdAt:'2026-11-08T00:00:00Z',updatedAt:'2026-11-08T00:01:00Z'}]}]} as unknown as DispatchState;
  const inspect=vi.fn(async()=>structuredClone(summary)),read=vi.fn(async()=>structuredClone(state)),knowledge=vi.fn(async()=>({revision:'knowledge-one'})),checks=vi.fn((snapshot:OutputManifestSnapshot,signal:AbortSignal)=>f.manifestFiles.check(snapshot,signal)),release=vi.fn(),acquire=vi.fn(()=>release);
  const owner={entry:{id:identity.workspaceId,path:f.directory},assert:()=>{},read:knowledge} as unknown as Pick<KnowledgeWorkspace,'entry'|'assert'|'read'>;
  const service=new OutputManifestReportService(owner,{read},{inspect,check:checks,acquireRead:acquire}),input={...identity,taskId:artifactBinding.taskId,runId:artifactBinding.runId};
  return {...f,summary,state,service,input,selected:{...input,manifestId:manifest.manifestId},manifest,inspect,read,knowledge,checks,release,acquire};
}
