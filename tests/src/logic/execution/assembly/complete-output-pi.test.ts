import fs from 'node:fs/promises';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
import {fixture} from '../../application/support/helpers';
import {Application} from '../../../../../src/bridge/server/application';
import {Paths} from '../../../../../src/logic/workspace/service/paths';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../../../../../src/logic/tools/rules/questions';
import {completeOutputProvider,completeOutputData as d} from './support/complete-output-provider';
import {seedCompleteOutput,completeOutputRecords} from './support/complete-output-pi-fixture';

// Real Pi writes, complete-set validation, and canonical identity; no legacy graph is manufactured.
it.each(['automatic','changed','human','human-saved-change'] as const)('recursive complete output and original-proof review (%s)',async mode=>{
  const human=mode.startsWith('human'),stale=mode==='human-saved-change';
  const f=await fixture(),provider=await completeOutputProvider(human?'human':mode as 'automatic'|'changed',false,false,true,stale);let app=f.app;
  try{
    const {entry}=await seedCompleteOutput(app,f.a,provider),start=await app.Dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const records=()=>completeOutputRecords(f.user,entry.id),extra=path.join(f.a,d.root,'extra.txt'),file=path.join(f.a,d.file);
    const rootDir=path.join(f.user,entry.id,'loop-engine/tasks',start.taskId,start.runId),readRoot=()=>new FileRunStorage().Read(rootDir);
    const questions=()=>app.Dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
    const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:60000,interval:40});expect(provider.errors).toEqual([])};
    await until(()=>expect(provider.state.readyForReview).toBe(true));
    expect(provider.member).toHaveLength(8);expect(provider.state.manifest.entryCount).toBe(3);
    expect(provider.state.delivery.delivery.workflow.validationChecks[0].manifest).toEqual(provider.state.validation.manifest);
    expect(provider.state.validation.manifest.manifestId).toBe(provider.state.manifest.manifestId);
    const ref=provider.state.call.agentCall,childDir=path.join(f.user,entry.id,'loop-engine/tasks',ref.taskId,ref.runId),childBytes=await fs.readFile(path.join(childDir,'events.jsonl'),'utf8');
    if(mode==='changed')await fs.writeFile(extra,'new file outside old JSON');provider.releaseReview();
    if(human){
      await until(async()=>expect(await questions()).toHaveLength(1));
      const question=(await questions())[0];expect(question.questions[0].options[0].label).toBe('接受此成果');
      await app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:'接受完整目录及其后代'}]});
      await until(async()=>{const list=await questions();expect(list).toHaveLength(1);expect(list[0].id).not.toBe(question.id)});
      const before=await readRoot(),record=before.events.find(e=>e.data.humanDecision)!.data.humanDecision as any;
      expect(record).toMatchObject({callerTaskId:start.taskId,callerRunId:start.runId,callId:'full-call',decision:'accept',original:provider.state.call.verification});
      expect(provider.main).toHaveLength(3);expect(before.events.some(e=>e.type==='tool.finished'&&e.data.id==='full-human')).toBe(false);
      if(stale)await fs.writeFile(extra,'changed after acceptance');
      const continuation=(await questions())[0];
      await app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:continuation.id,answers:[{option:0,other:''}]});
      await until(()=>expect(provider.state.humanReview).toBeDefined());
      if(stale){
        expect(provider.state.humanReview.error).toBeTruthy();expect(provider.state.humanReview.record).toBeUndefined();
        const after=await readRoot();expect(after.events.filter(e=>e.data.humanDecision).map(e=>e.data.humanDecision)).toEqual([record]);
        expect(after.events.find(e=>e.data.phase==='decision_released')?.data).toMatchObject({continued:false,reason:'verification_failed'});
      }else expect(provider.state.humanReview).toMatchObject({record,continued:true,executionAuthorized:false});
    }
    await until(async()=>{expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
    expect(provider.member).toHaveLength(8);expect(provider.main).toHaveLength(human?4:3);
    if(mode==='changed')expect(provider.state.review.error).toBeTruthy();else expect(provider.state.review.state).toBe('verified');
    expect(await fs.readFile(file,'utf8')).toBe(d.content);expect(await fs.readFile(childDir+'/events.jsonl','utf8')).toBe(childBytes);
    expect((await app.Dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:start.taskId}})).tasks).toHaveLength(0);
    const final=await records(),rootBytes=await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8'),sequence=[...provider.sequence],stat=await fs.stat(file);
    await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
    expect(await records()).toEqual(final);expect(await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8')).toBe(rootBytes);
    expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);expect(provider.sequence).toEqual(sequence);
    expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);expect(await fs.readFile(file,'utf8')).toBe(d.content);expect(await questions()).toEqual([]);
    if(stale||mode==='changed')expect(await fs.readFile(extra,'utf8')).toBe(stale?'changed after acceptance':'new file outside old JSON');
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/complete-output-recursive-'+mode+'.json',JSON.stringify({error:String(error),providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)},null,2));throw error}
  finally{provider.releaseAll();await app.Shutdown();await f.cleanup();await provider.close()}
},180000);
