import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {seedKnowledgeSource,knowledgeSourceFixture,knowledgeSourceDiskEvidence,knowledgeSourceHttpProbe} from './knowledge-source-lifecycle-fixture';
import {memberCheckpointProvider,memberCheckpointFixture} from './owner-legacy-checkpoint-provider';
import {scopeUsageProvider,scopeUsageFixture} from './owner-legacy-usage-provider';
import {workflowConditionRecords} from './workflow-condition-fixture';

export const ownerExecutionLegacyExecutable=()=>path.resolve(process.env.CBIM_OWNER_LEGACY_EXE??'build/20261107-235854/CBIM Assistant-win32-x64/CBIM.exe');

/** Only the released pre-owner binary creates these legacy facts; current constructors cannot write a synthetic old journal. */
export async function createOwnerExecutionLegacyFixture(){
  const executable=ownerExecutionLegacyExecutable();
  await fs.access(executable);assert.ok(executable.includes('20261107-235854'));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-owner-legacy-')),user=path.join(temp,'user'),probe=await knowledgeSourceHttpProbe(),checkpoint=await memberCheckpointProvider('complete'),running=await scopeUsageProvider();
  const pageErrors:string[]=[];let desktop:ElectronApplication|undefined,killedPid:number|undefined;
  try{
    desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});const page=await desktop.firstWindow();page.on('pageerror',error=>pageErrors.push(error.message));await page.waitForFunction(()=>!!(window as any).cbim);
    const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
    const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(checkpoint.errors,[]);assert.deepEqual(running.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('Old executable fixture timeout: '+label)};
    const seeded=await seedKnowledgeSource(call,temp,probe.url,true),id=seeded.entry.id,agentId=knowledgeSourceFixture.agentId,moduleId=knowledgeSourceFixture.moduleId;
    checkpoint.bind(agentId,moduleId);running.bind(agentId,moduleId);
    for(let index=1;index<memberCheckpointFixture.files.length;index++)await fs.writeFile(path.join(seeded.project,memberCheckpointFixture.files[index]),memberCheckpointFixture.facts[index]);
    await fs.writeFile(path.join(seeded.project,scopeUsageFixture.file),scopeUsageFixture.fact);
    const profile=async(name:string,model:string,baseUrl:string)=>{const saved=await call('models.save',{profile:{name,api:'openai-completions',baseUrl,auth:'none',defaultModel:model,models:[{id:model,name,enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false}]}});const item=saved.profiles.find((item:{name:string})=>item.name===name);assert.ok(item);return item.id as string};
    const checkpointProfile=await profile('Legacy checkpoint real Pi',memberCheckpointFixture.model,checkpoint.url),runningProfile=await profile('Legacy running real Pi',scopeUsageFixture.model,running.url);
    const queuedRoot='legacy-owner-queued',runningRoot='legacy-owner-running';
    const assign=async(rootSessionId:string,goal:string)=>{
      await call('dispatch.open',{workspaceId:id,rootSessionId,commandId:randomUUID()});
      const input={workspaceId:id,rootSessionId,commandId:randomUUID(),expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[moduleId],goal,acceptance:[{id:'read',text:'读取本机隔离材料并保留真实回执'}],prerequisites:[]}};
      return {input,receipt:await call('dispatch.task',input)};
    };
    const queued=await assign(queuedRoot,'旧版本真实排队任务：不得在新版本按 Agent 猜测岗位并启动');
    const main=await call('loop.chat',{id,message:memberCheckpointFixture.goal,options:{profileId:checkpointProfile,model:memberCheckpointFixture.model,permission:'execute',turnTimeoutMs:120000}});
    await until(async()=>!!checkpoint.state.parked,'真实旧成员已核实文件并停泊');
    const parked=await call('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:main.taskId}}) as GraphSnapshot;
    const checkpointTask=parked.tasks.find(task=>task.checkpoints?.length)!;assert.ok(checkpointTask);assert.equal(checkpointTask.status,'checkpointed');assert.equal(checkpointTask.ownerBinding,undefined);
    const live=await assign(runningRoot,scopeUsageFixture.memberGoal),run=await call('dispatch.executionStart',{workspaceId:id,rootSessionId:runningRoot,taskId:live.receipt.taskId,commandId:randomUUID(),expectedRevision:1,options:{profileId:runningProfile,model:scopeUsageFixture.model,permission:'read',turnTimeoutMs:120000}});
    await until(async()=>running.member.length===1,'第二个真实旧成员进入模型 HTTP，尚未返回');
    const liveView=await call('dispatch.executionInspect',{workspaceId:id,rootSessionId:runningRoot,taskId:live.receipt.taskId});assert.equal(liveView.runs[0].status,'running');
    const queuedGraph=await call('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:queuedRoot}}) as GraphSnapshot;
    assert.equal(queuedGraph.tasks[0].status,'queued');assert.deepEqual(queuedGraph.tasks[0].runIds,[]);assert.equal(queuedGraph.tasks[0].ownerBinding,undefined);
    const records=await workflowConditionRecords(user,id),disk=await knowledgeSourceDiskEvidence(user,id);
    const originalRunBytes=await Promise.all(records.runs.map(async record=>{
      assert.ok(record.session.sessionFile);assert.ok(record.session.nativeSessionId);
      const canonicalPath=path.join(user,id,'dispatch','runs','tasks',record.binding.taskId,record.binding.runId,'events.jsonl');
      const canonical=await fs.readFile(canonicalPath),native=await fs.readFile(record.session.sessionFile);assert.ok(canonical.length&&native.length);
      const events=canonical.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(event=>event.type==='session.bound'&&event.data.sessionId===record.session.nativeSessionId));
      return {taskId:record.binding.taskId,runId:record.binding.runId,canonicalPath,sessionFile:record.session.sessionFile,canonical,native};
    }));
    const provenance=await desktop.evaluate(()=>({pid:process.pid,userRoot:process.env.CBIM_USER_DATA_ROOT,exe:process.execPath}));
    assert.equal(path.resolve(provenance.userRoot!),path.resolve(user));assert.equal(path.resolve(provenance.exe),path.resolve(executable));assert.ok(Number.isInteger(provenance.pid));
    // A genuine process termination leaves persisted queued/running/checkpoint facts. It is not a thrown application exception or graceful shutdown.
    killedPid=provenance.pid;
    const killed=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{const child=spawn('taskkill.exe',['/PID',String(provenance.pid),'/T','/F'],{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}))});
    assert.equal(killed.code,0);await desktop.close().catch(()=>{});desktop=undefined;checkpoint.releaseCheckpoint();checkpoint.releaseResume();running.releaseMember();
    const after=await knowledgeSourceDiskEvidence(user,id);assert.deepEqual(after.dispatchBytes,disk.dispatchBytes);assert.deepEqual(pageErrors,[]);assert.deepEqual(probe.requests,[]);
    const evidence={executable,temp,user,workspaceId:id,project:seeded.project,seeded,queued,queuedGraph,live,run,liveView,main,parked,checkpointTaskId:checkpointTask.taskId,records,killedPid,termination:killed,dispatchSha256:createHash('sha256').update(disk.dispatchBytes).digest('hex'),requestCounts:{checkpointMain:checkpoint.main.length,checkpointMember:checkpoint.member.length,heldRunningMember:running.member.length,unexpectedModel:probe.requests.length},pageErrors,retained:true,createdThrough:'Actual pre-owner Step32 EXE public IPC and real local Pi; no manually written journal, owner binding, or successful proof'};
    await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/owner-execution-legacy-fixture.json',JSON.stringify(evidence,null,2));await fs.writeFile('test-results/owner-execution-legacy-dispatch-before.jsonl',disk.dispatchBytes);
    return {temp,user,workspaceId:id,evidence,originalRunBytes,counts:()=>({checkpointMain:checkpoint.main.length,checkpointMember:checkpoint.member.length,heldRunningMember:running.member.length,unexpectedModel:probe.requests.length}),providerErrors:()=>[...checkpoint.errors,...running.errors],cleanup:async(remove=false)=>{await probe.close();await checkpoint.close();await running.close();if(remove){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-owner-legacy-'));assert.equal((await fs.lstat(target)).isSymbolicLink(),false);await fs.rm(target,{recursive:true,force:true})}}};
  }catch(error){
    if(desktop)await desktop.close().catch(()=>{});await probe.close();await checkpoint.close();await running.close();await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/owner-execution-legacy-seed-failure.json',JSON.stringify({executable,temp,user,error:String(error),killedPid,pageErrors,checkpointErrors:checkpoint.errors,runningErrors:running.errors,requestCounts:{checkpointMain:checkpoint.main.length,checkpointMember:checkpoint.member.length,heldRunningMember:running.member.length},retained:true},null,2));throw error;
  }
}
