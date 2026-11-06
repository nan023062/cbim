import {afterEach,expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import type {TaskSpec} from '../src/backend/core/brain/types';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0)){const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-log-integrity-'))throw Error('Unexpected cleanup path');await fs.rm(target,{recursive:true,force:true})}});
async function fixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-log-integrity-'));directories.push(directory);
  const task:TaskSpec={taskId:'task',workspaceId:'workspace',root:directory,goal:'Verify journal integrity',moduleIds:[],acceptance:[]};
  const journal=new RunJournal(directory,task,'run');await journal.init();await journal.append({type:'run.started',data:{task}});await journal.append({type:'run.settled',data:{status:'completed'}});
  return {directory,file:path.join(directory,'events.jsonl')};
}
test('read preserves an incomplete tail and reports it even after a settled prefix',async()=>{
  const f=await fixture();expect((await RunJournal.read(f.directory)).logIntegrity).toEqual({partialTail:false});
  await fs.appendFile(f.file,'{"private-partial');const before=await fs.readFile(f.file);
  const summary=await RunJournal.read(f.directory);expect(summary.logIntegrity).toEqual({partialTail:true});expect(summary.events).toHaveLength(2);expect(summary.status).toBe('completed');
  expect(await fs.readFile(f.file)).toEqual(before);expect(JSON.stringify(summary)).not.toContain('private-partial');
});
test('a malformed complete line returns a stable error without source content and does not repair the file',async()=>{
  const f=await fixture();await fs.appendFile(f.file,'{"secret-private-broken\n');const before=await fs.readFile(f.file);
  const error=await RunJournal.read(f.directory).catch(cause=>cause);expect(error).toMatchObject({code:'RUN_LOG_INVALID'});expect(error.message).not.toContain('secret-private-broken');expect(await fs.readFile(f.file)).toEqual(before);
});
test('missing journal retains its IO code and is not treated as an empty execution',async()=>{
  const f=await fixture();await expect(RunJournal.read(path.join(f.directory,'missing'))).rejects.toMatchObject({code:'ENOENT'});
});
test('only zero bytes has a fresh-log code; an incomplete first event is invalid and never silently repaired',async()=>{
  const f=await fixture();await fs.writeFile(f.file,'');await expect(RunJournal.read(f.directory)).rejects.toMatchObject({code:'RUN_LOG_EMPTY'});
  await fs.writeFile(f.file,'{"version":');await expect(RunJournal.read(f.directory)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});expect(await fs.readFile(f.file,'utf8')).toBe('{"version":');
});
test('known incomplete log cannot be resumed and releases the preflight lease without creating an engine',async()=>{
  const f=await fixture(),original=await RunJournal.read(f.directory);await fs.appendFile(f.file,'{"unfinished');
  const storage=new FileRunStorage();storage.read=()=>RunJournal.read(f.directory);let leases=0,engines=0;
  const runtime=new LoopRuntime({storage,directory:f.directory,acquireLease:async()=>{leases++;return()=>{leases--}},createEngine:()=>{engines++;throw Error('Must not construct engine')},toolPolicy:async()=>({allow:false})});
  try{await expect(runtime.start(original.task,'Continue',{runId:original.runId,reconciledToolIds:[]})).rejects.toThrow('尾行不完整');expect(leases).toBe(0);expect(engines).toBe(0)}finally{await runtime.close()}
});
