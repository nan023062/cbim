import {expect,vi} from 'vitest';
import {fixture} from './helpers';
import {Application as ConcreteApplication} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';
import {humanDecisionProvider} from './human-decisions-provider';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/bridge/server/application';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {humanDecisionFixture as data} from './human-decisions-provider';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
export {queuedTaskCancelRecords as humanDecisionRecords} from './queued-task-cancel-fixture';

/** Isolated empty project: the artifact is created by real Pi's native write, not seeded as a fake result. */
export async function seedHumanDecision(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  const models=await app.models.save({profile:{name:'Human decision fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Human decision fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'human-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'human-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:models.profiles.find(profile=>profile.name==='Human decision fixture')!.id,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);return {entry,team};
}

/** Real canonical and native history bytes in the isolated user root; human records are stored separately. */
export async function humanDecisionLogBytes(user:string,workspaceId:string){
  const base=path.join(user,workspaceId),result:Record<string,string>={};
  const walk=async(directory:string)=>{for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else if(item.name.endsWith('.jsonl')&&item.name!=='dispatch.jsonl')result[path.relative(base,file)]=await fs.readFile(file,'utf8')}};
  await walk(base);return result;
}

export const humanReviewLabels={accept:'接受此成果',reject:'不接受此成果',request_evidence:'要求补充证据'} as const;

/** 使用实际新工具链、问题队列、文件与 canonical；不创建旧目标/派工等待图。 */
export async function prepareRecursiveHumanReview(reconsider=false,afterReview?:'call'|'write'|'read',tokenLimit?:number){
  const f=await fixture(),provider=await humanDecisionProvider(reconsider,afterReview);let app=f.app;
  try{
    const {entry}=await seedHumanDecision(app,f.a,provider);
    if(tokenLimit!==undefined)await app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:tokenLimit}});
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const rootDir=path.join(f.user,entry.id,'loop-engine/tasks',start.taskId,start.runId);
    const read=()=>new FileRunStorage().read(rootDir);
    const questions=()=>app.dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
    const until=async(check:()=>Promise<void>|void)=>{
      await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:20000,interval:30});
      expect(provider.errors).toEqual([]);
    };
    const question=async(previous?:string)=>{
      await until(async()=>{const list=await questions();expect(list).toHaveLength(1);if(previous)expect(list[0].id).not.toBe(previous)});
      return (await questions())[0];
    };
    const answer=async(q:PendingQuestion,label:string)=>{
      const option=q.questions[0].options.findIndex(o=>o.label===label);expect(option).toBeGreaterThanOrEqual(0);
      await app.dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:q.id,answers:[{option,other:data.comment}]});
    };
    const first=await question();
    expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(7);
    expect(provider.state.baselineId).toBeTruthy();expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
    const reference=provider.state.call.agentCall,childDir=path.join(f.user,entry.id,'loop-engine/tasks',reference.taskId,reference.runId);
    const childBefore=await fs.readFile(path.join(childDir,'events.jsonl'),'utf8');
    const stateBefore=await app.workspace(entry.id).dispatchStore.read();
    expect(stateBefore.graphs[0].tasks).toEqual([]);expect(stateBefore.agentBusinessRuns).toHaveLength(1);
    const decisions=async()=>(await read()).events.filter(e=>e.data.humanDecision).map(e=>e.data.humanDecision as any);
    const saved=async(q:PendingQuestion,decision:keyof typeof humanReviewLabels)=>{
      await answer(q,humanReviewLabels[decision]);const continuation=await question(q.id);
      const records=await decisions(),record=records.at(-1);
      expect(record).toMatchObject({callerTaskId:start.taskId,callerRunId:start.runId,callId:'human-call',decision,original:provider.state.call.verification,answer:{answer:humanReviewLabels[decision],supplement:data.comment}});
      expect((await read()).events.some(e=>e.type==='tool.finished'&&e.data.id===record.reviewToolCallId)).toBe(false);
      expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBefore);
      expect((await app.workspace(entry.id).dispatchStore.read()).agentBusinessRuns).toEqual(stateBefore.agentBusinessRuns);
      expect(provider.member).toHaveLength(7);return {continuation,record};
    };
    const stopAndReopen=async()=>{
      await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
      await until(()=>expect(app.runtime.snapshot().pressure.activeRuns).toBe(0));
      const sequence=[...provider.sequence],logs=await humanDecisionLogBytes(f.user,entry.id),state=await app.workspace(entry.id).dispatchStore.read(),records=await decisions();
      expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBefore);
      await app.shutdown();app=new ConcreteApplication(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();await app.open(entry.id);
      expect(await questions()).toEqual([]);expect(await decisions()).toEqual(records);
      expect(await humanDecisionLogBytes(f.user,entry.id)).toEqual(logs);
      expect(await app.workspace(entry.id).dispatchStore.read()).toEqual(state);
      expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
      return records;
    };
    return {f,provider,get app(){return app},entry,start,first,read,question,answer,decisions,saved,stopAndReopen,until,cleanup:async()=>{await app.shutdown();await provider.close();await f.cleanup()}};
  }catch(error){await app.shutdown();await provider.close();await f.cleanup();throw error}
}
