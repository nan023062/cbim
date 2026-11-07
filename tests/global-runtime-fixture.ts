import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import {scopeWaitProvider,waitFixture} from './scope-wait-provider';
import {globalAdmissionProvider,globalAdmissionFixture} from './global-admission-provider';
import {seedGlobalAdmission,admissionScopes} from './global-admission-fixture';
export {waitFixture,globalAdmissionFixture,admissionScopes};

export const globalRuntimeFixture={waitingModel:'runtime-waiting',waitingModelLabel:'Runtime waiting',drafts:{waiting:'等待目标的草稿必须保留。',a:'A 活动成员会话的草稿必须保留。',b:'B 准入等待会话的草稿必须保留。'}};

/** Reuse unchanged real Pi providers: one safe waiting conversation and two independently admitted collaborations. */
export async function globalRuntimeProviders(){
  const waiting=await scopeWaitProvider(),admission=await globalAdmissionProvider();
  return {waiting,admission,counts:()=>({waitingMain:waiting.mainRequests.length,waitingMember:waiting.memberRequests.length,aMain:admission.projects.a.main.length,aMember:admission.projects.a.member.length,bMain:admission.projects.b.main.length,bMember:admission.projects.b.member.length}),errors:()=>[...waiting.errors,...admission.errors],close:async()=>{await waiting.close();await admission.close()}};
}

export async function seedGlobalRuntime(app:Application,projects:{a:string;b:string},providers:Awaited<ReturnType<typeof globalRuntimeProviders>>){
  const seeded=await seedGlobalAdmission(app,projects,providers.admission),data=globalRuntimeFixture;
  providers.waiting.bind(seeded.a.team.input.agentId,seeded.a.team.input.moduleId);await fs.writeFile(path.join(projects.a,'wait-input.txt'),waitFixture.fact);
  await app.models.save({profile:{name:'Global runtime waiting fixture',api:'openai-completions',baseUrl:providers.waiting.url,auth:'none',defaultModel:data.waitingModel,models:[{id:data.waitingModel,name:data.waitingModelLabel,enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const waitingProfileId=(await app.models.list()).profiles.find(profile=>profile.name==='Global runtime waiting fixture')!.id;
  return {...seeded,waitingProfileId};
}

/** Canonical event bytes only, so observational runtime indexing is not mistaken for execution or rewriting logs. */
export async function globalRuntimeLogBytes(user:string,workspaceId:string){
  const base=path.join(user,workspaceId),result:Record<string,string>={};
  const walk=async(directory:string)=>{for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else if(item.name.endsWith('.jsonl')&&item.name!=='dispatch.jsonl')result[path.relative(base,file)]=await fs.readFile(file,'utf8')}};
  await walk(base);return result;
}
