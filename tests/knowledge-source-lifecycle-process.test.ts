import {it,expect} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {fixture} from './helpers';
import {seedKnowledgeSource,knowledgeSourceFixture as data,knowledgeSourceDiskEvidence,knowledgeSourceHttpProbe} from './knowledge-source-lifecycle-fixture';
import {knowledgeSourceChangeSchema,type KnowledgeSourceChange} from '../src/backend/core/workspace/knowledge-source';

it('an actually terminated child after committed knowledge reopens by settling only the original source transaction',async()=>{
  const f=await fixture(),probe=await knowledgeSourceHttpProbe();let app=f.app,child:ChildProcess|undefined;
  try{
    const seeded=await seedKnowledgeSource((action,input)=>app.dispatch(action,input),f.temp,probe.url),id=seeded.entry.id;await app.shutdown();
    child=fork(path.resolve('tests/knowledge-source-crash-child.ts'),[f.user,id],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
    const gate=await new Promise<{kind:string;pid:number;planId:string;journalPath:string;transitionId:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Real child did not reach the committed gate: '+output)),45000);child!.once('message',value=>{clearTimeout(timer);const message=value as {kind:string;pid:number;planId:string;journalPath:string;transitionId:string};if(message.kind!=='actual-committed-before-source-final')reject(Error(JSON.stringify(value)));else resolve(message)});child!.once('error',error=>{clearTimeout(timer);reject(error)});child!.once('exit',code=>{clearTimeout(timer);reject(Error('Child exited before gate '+code+' '+output))})});
    expect(gate.pid).toBe(child.pid);const file=path.join(seeded.project,...(data.agentId+'/principles.md').split('/')),bytes=await fs.readFile(file),mtime=(await fs.stat(file)).mtimeMs,journalBytes=await fs.readFile(gate.journalPath),journal=JSON.parse(journalBytes.toString('utf8'));
    expect(bytes.toString('utf8')).toBe(data.changedPrinciples);expect(journal.state).toBe('committed');const before=await knowledgeSourceDiskEvidence(f.user,id);
    const exit=once(child,'exit');expect(child.kill('SIGKILL')).toBe(true);await exit;child=undefined;
    app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(app.workspace(id).state).toBe('running');expect(await app.workspace(id).sources!.pending()).toEqual([]);
    expect(await fs.readFile(file)).toEqual(bytes);expect((await fs.stat(file)).mtimeMs).toBe(mtime);expect(await fs.readFile(gate.journalPath)).toEqual(journalBytes);
    const after=await knowledgeSourceDiskEvidence(f.user,id),events:KnowledgeSourceChange[]=after.dispatchBytes.toString('utf8').split('\n').filter(Boolean).flatMap(line=>(JSON.parse(line).body.mutation.knowledgeSourceChanges??[]).map((value:unknown)=>knowledgeSourceChangeSchema.parse(value)));
    expect(after.dispatchBytes.subarray(0,before.dispatchBytes.length)).toEqual(before.dispatchBytes);expect(events.filter(event=>event.kind==='prepared'&&event.transition.transitionId===gate.transitionId)).toHaveLength(1);expect(events.filter(event=>event.kind==='resolved'&&event.transitionId===gate.transitionId&&event.outcome==='committed')).toHaveLength(1);
    const original=await app.workspace(id).committedReceipt(journal.source.request);expect(original).toEqual(journal.result);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect((await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes).toEqual(after.dispatchBytes);expect(await fs.readFile(file)).toEqual(bytes);expect((await fs.stat(file)).mtimeMs).toBe(mtime);expect(probe.requests).toEqual([]);
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/knowledge-source-actual-process-exit.json',JSON.stringify({actualChildPid:gate.pid,termination:'SIGKILL after actual committed journal, before source final',planId:gate.planId,transitionId:gate.transitionId,committedJournalUnchanged:true,knowledgeBytesAndMtimeUnchanged:true,onePreparedOneResolved:true,secondRestartNoWrites:true,modelHttpRequests:0},null,2));
  }finally{if(child&&child.exitCode===null)child.kill('SIGKILL');await app.shutdown();await f.cleanup();await probe.close()}
},90000);
