import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {ChatInputs} from '../src/backend/main/persistence/tasks/chat-inputs';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {attachmentFixture,waitingAttachmentsProvider} from './waiting-attachments-provider';

export const attachmentHash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
function pngChunk(type:string,data:Buffer){const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,body,tail])}
export function attachmentPng(){const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,255,0,0,0,0,255,255,255,255]))),pngChunk('IEND',Buffer.alloc(0))])}
export async function attachmentWait(check:()=>Promise<boolean>,label:string,timeout=40000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,35))}throw Error('等待附件验收超时：'+label)}

/** 用同一真实 Application 建立隔离知识、模型和附件源；桌面与 Pi 共用服务数据而非伪造调度状态。 */
export async function seedWaitingAttachments(app:Application,project:string,provider:Awaited<ReturnType<typeof waitingAttachmentsProvider>>){
  const png=attachmentPng(),sources={text:path.join(project,'reference.txt'),image:path.join(project,'reference.png'),draft:path.join(project,'ordinary-draft.txt')};
  await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'waiting-input.txt'),attachmentFixture.fact);await fs.writeFile(sources.text,attachmentFixture.text);await fs.writeFile(sources.image,png);await fs.writeFile(sources.draft,'普通草稿附件，不能混入目标补充');
  const saved=await app.models.save({profile:{name:'Local waiting attachment fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'attachment-vision',models:['attachment-vision','attachment-plain'].map(id=>({id,name:id,enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,vision:id==='attachment-vision',pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}))}});
  const profileId=saved.selectedId!,entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'attachment-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'attachment-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  provider.bind(team.input.agentId,team.input.moduleId,png.toString('base64'));
  const scopes=async()=>{const raw=await fs.readFile(path.join(app.paths.project(entry.id),'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);assert.equal(body.workspaceId,entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope)}return [...found.values()]};
  const options={provider:'cbim-'+profileId,model:'attachment-vision',profileId,permission:'read' as const,turnTimeoutMs:30000};
  const continuation=(scope:DispatchScope,ids:string[],overrides:Partial<GoalContinuationRequest>={}):GoalContinuationRequest=>({...{workspaceId:entry.id,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,waitId:scope.wait!.waitId,expectedGoalRevision:scope.goal!.revision,expectedInputRevision:scope.goal!.inputRevision??1,commandId:randomUUID(),input:{message:attachmentFixture.supplement,attachmentIds:ids},options},...overrides});
  return {entry,profileId,team,sources,png,scopes,options,continuation,
    importFiles:async(current:Application)=>{const inputs=new ChatInputs(current.workspace(entry.id));return [await inputs.path('file',sources.text),await inputs.path('file',sources.image)]},
    snapshotPath:(id:string)=>path.join(app.paths.project(entry.id),'chat-inputs',id+'.json'),
    reopen:(user:string)=>new Application(new Paths(user,path.resolve('.')),path.resolve('design')),
  };
}
