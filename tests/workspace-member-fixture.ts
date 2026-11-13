import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Application} from '../src/bridge/server/application';
import type {LlmDefinition} from '../src/logic/models';
import type {WorkspaceMemberChangeInput} from '../src/logic/team/rules/workspace-member';
import type {DispatchStore} from '../src/logic/dispatch/rules/dispatch-storage';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
export {repositoryConnectionRunFiles as workspaceMemberRunFiles} from './repository-connection-fixture';

export const workspaceMemberFixture={
  firstName:'客户端实现岗位',secondName:'客户端复核岗位',renamed:'客户端实现岗位（职责修订）',
  position:'核实当前模块边界与实际证据，记录实现职责；本片登记不启动执行。',
  instructions:'按本项目模块边界工作；需要正式任务时由主调度单独安排。',
  reason:'通过本机显式操作登记长期岗位，保持静态能力与执行实例分离。',
  draft:'岗位登记期间保留普通会话草稿，不发送模型。',
  otherDraft:'工作区 B 的独立普通草稿。',
  changedPrinciples:'\n\n岗位登记验收：新增来源原则，必须明确采纳才成为岗位快照。\n',
  changedSkill:'\n\n岗位登记验收：团队继承规则更新，保留原采纳内容直至明确采纳。\n',
} as const;

/** Actual HTTP listener: any unexpected model request is counted and fails, instead of faking a model response. */
export async function workspaceMemberHttpProbe(){
  const requests:Array<{method:string;url:string}>=[];
  const server=http.createServer((req,res)=>{requests.push({method:req.method??'',url:req.url??''});req.resume();res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Registration must not call a model'}))});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('HTTP probe did not bind');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,close:async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}};
}

/** Seed real knowledge transactions and an explicit credential-free model configuration. No registry result is fabricated. */
export async function seedWorkspaceMembers(app:Application,temp:string,baseUrl:string){
  const project=path.join(temp,'workspace-members-alpha'),otherProject=path.join(temp,'workspace-members-beta');
  await Promise.all([fs.mkdir(project,{recursive:true}),fs.mkdir(otherProject,{recursive:true})]);
  const entry=await app.dispatch('add',{path:project}),other=await app.dispatch('add',{path:otherProject});
  const team=await seedTeam(app.workspace(entry.id));
  const definition:LlmDefinition={name:'岗位登记隔离模型配置',api:'openai-completions',baseUrl,auth:'none',defaultModel:'member-explicit-a',models:[
    {id:'member-explicit-a',name:'岗位模型 A',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,vision:false},
    {id:'member-explicit-b',name:'岗位模型 B',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,vision:false},
  ]};
  const settings=await app.models.save({profile:definition}),profile=settings.profiles.find(item=>item.name===definition.name);if(!profile)throw Error('Explicit fixture profile was not saved');
  const profileId=profile.id,modelId=definition.models[0].id;
  const register=(name:string=workspaceMemberFixture.firstName):WorkspaceMemberChangeInput=>({kind:'register',agentId:team.input.agentId,name,position:workspaceMemberFixture.position,adaptation:{instructions:workspaceMemberFixture.instructions,references:[team.input.moduleId,team.shared]},runtimePolicy:{profileId,modelId},reason:workspaceMemberFixture.reason});
  return {project,otherProject,entry,other,team,profileId,modelId,definition,register};
}

/** Explicit fixture-side source change through the actual knowledge transaction, not a registration side effect. */
export async function changeWorkspaceMemberCapability(app:Application,workspaceId:string,agentId:string,sharedSkillId:string){
  const workspace=app.workspace(workspaceId),snapshot=await workspace.snapshot();
  const definitionFile=snapshot.files.find(file=>file.path===agentId+'/agent.json');if(!definitionFile)throw Error('Seeded Agent definition is missing');
  const definition=JSON.parse(definitionFile.text) as {work_principles:string};
  const principlesPath=agentId+'/'+definition.work_principles,principles=snapshot.files.find(file=>file.path===principlesPath);
  const skill=snapshot.files.find(file=>file.path===sharedSkillId+'/SKILL.md');if(!principles||!skill)throw Error('Seeded capability source is missing');
  const changes=[{path:principlesPath,text:principles.text+workspaceMemberFixture.changedPrinciples},{path:skill.path,text:skill.text+workspaceMemberFixture.changedSkill}];
  await workspace.commit(request(snapshot,changes));return {changes,revision:(await workspace.snapshot()).revision};
}

/** Knowledge journals and bytes must not change merely because a position is registered or read. */
export async function workspaceMemberKnowledgeEvidence(app:Application,user:string,workspaceId:string){
  const snapshot=await app.workspace(workspaceId).snapshot(),directory=path.join(user,workspaceId,'transactions');
  let names:string[]=[];try{names=(await fs.readdir(directory)).filter(name=>name.endsWith('.json')).sort()}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const journals=await Promise.all(names.map(async name=>({name,sha256:createHash('sha256').update(await fs.readFile(path.join(directory,name))).digest('hex')})));
  return {revision:snapshot.revision,files:snapshot.files,journals};
}

/** Registry writes share the dispatch journal, but cannot mutate runtime graphs, messages, instances, sessions or runs. */
export async function workspaceMemberRuntimeEvidence(app:Application,workspaceIds:string[]){
  const workspaces=[];
  for(const id of workspaceIds){const state=await (app.memberDispatch(id) as unknown as {store:DispatchStore}).store.read();workspaces.push({workspaceId:id,members:state.members,sessions:state.sessions,graphs:state.graphs,outbox:state.outbox,runs:state.runs??[],scopes:state.scopes??[],mainSessions:await app.dispatch('loop.list',{id})})}
  return workspaces;
}

/** Invoke the real public preview and commit actions. A fresh command is generated only for a new explicit change. */
export async function commitWorkspaceMember(app:Application,workspaceId:string,change:WorkspaceMemberChangeInput){
  const identity={workspaceId,instanceId:app.workspace(workspaceId).instanceId};
  const {workspaceMemberPreviewSchema,workspaceMemberReceiptSchema}=await import('../src/logic/team/rules/workspace-member');
  const preview=workspaceMemberPreviewSchema.parse(await app.dispatch('workspace.members.preview',{...identity,change}));
  const input={...identity,change,commandId:randomUUID(),expectedRegistryCursor:preview.registryCursor,expectedBasis:preview.basis};
  const receipt=workspaceMemberReceiptSchema.parse(await app.dispatch('workspace.members.commit',input));
  return {preview,input,receipt};
}
