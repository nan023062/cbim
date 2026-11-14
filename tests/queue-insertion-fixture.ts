import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/bridge/server/application';
import {ChatInputs} from '../src/logic/materials/service/chat-inputs';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import {attachmentPng} from './waiting-attachments-fixture';
import {insertionData as data} from './queue-insertion-provider';

export async function insertionWait(check:()=>Promise<boolean>,label:string,timeout=40000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('队列插入验收超时：'+label)}
export async function seedInsertion(app:Application,project:string,provider:{url:string}){
  await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'queue-original.txt'),data.fact);const png=attachmentPng(),source=path.join(project,'queue-reference.png');await fs.writeFile(source,png);
  const models=await app.models.save({profile:{name:'Local queue insertion fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[data.model,data.otherModel].map(id=>({id,name:id,enabled:true,vision:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}))}});
  const entry=await app.dispatch('add',{path:project}),image=await new ChatInputs(app.workspace(entry.id)).path('file',source),snapshot=path.join(app.paths.project(entry.id),'chat-inputs',image.id+'.json');
  const scopes=async()=>{const raw=await fs.readFile(path.join(app.paths.project(entry.id),'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);for(const item of body.mutation.scopes??[])found.set(item.scopeId,item)}return [...found.values()]};
  return {entry,image,snapshot,png,scopes,options:{profileId:models.selectedId!,model:data.model,permission:'read' as const,turnTimeoutMs:60000},queuedOptions:{profileId:models.selectedId!,model:data.otherModel,permission:'execute' as const,turnTimeoutMs:60000}};
}
