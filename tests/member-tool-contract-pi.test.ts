import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {MemberHelpTools} from '../src/logic/tasks/rules/member-help-tools';
import type {MemberHelpStaged} from '../src/logic/tasks/rules/member-help';
import {RunMemberCheckpoint} from '../src/logic/execution/rules/capabilities/member-checkpoint';
import type {MemberCheckpointInput,MemberCheckpointStaged} from '../src/logic/tasks/rules/member-checkpoint';
import {mainToolContractFixture as data} from './main-tool-contract-provider';
import {seedMainToolContract,mainToolContractRecords,mainToolContractLogBytes} from './main-tool-contract-fixture';
import {memberToolContractProvider,type MemberToolFault} from './member-tool-contract-provider';

it.each(['help','checkpoint']as MemberToolFault[])('retains a real staged record but rejects corrupt member output without a safe handoff (%s)',async mode=>{
  const f=await fixture(),provider=await memberToolContractProvider(mode);let app=f.app,saveCalls=0;const stageType=mode==='help'?'task.help_requested':'task.checkpoint_requested';
  try{
    const {entry}=await seedMainToolContract(app,f.a,provider);
    if(mode==='help'){
      const original=MemberHelpTools.prototype.call;
      vi.spyOn(MemberHelpTools.prototype,'call').mockImplementation(async function(this:MemberHelpTools,...args:Parameters<typeof original>){
        const self=this as unknown as {ports:{save(value:MemberHelpStaged):Promise<void>}},save=self.ports.save;
        // Save a real independent record first, then corrupt only the value that the production wrapper returns.
        self.ports.save=async value=>{await save(structuredClone(value));saveCalls++;value.binding.rootSessionId='private-corrupt-member-output'};
        try{return await original.apply(this,args)}finally{self.ports.save=save}
      });
    }else{
      const prototype=RunMemberCheckpoint.prototype as unknown as {stage(input:MemberCheckpointInput,id:string):Promise<MemberCheckpointStaged>},stage=prototype.stage;
      vi.spyOn(prototype,'stage').mockImplementation(async function(this:RunMemberCheckpoint,input,id){const value=await stage.call(this,input,id);saveCalls++;return {...value,binding:{...value.binding,rootSessionId:'private-corrupt-member-output'}}});
    }
    const started=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:mode==='checkpoint'?'execute':'read',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>mainToolContractRecords(f.user,entry.id),graph=()=>app.dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(async()=>{if(provider.errors.length)return;expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:40000,interval:30});expect(provider.errors,JSON.stringify(provider.errors)).toEqual([]);
    const saved=await records(),finished=await graph(),task=finished.tasks[0];expect(saveCalls).toBe(1);expect(saved.scopes).toHaveLength(1);expect(saved.scopes[0].outcome).toBe('failed');expect(saved.scopes[0].goal?.review?.decision).toBe('blocked');expect(finished.tasks).toHaveLength(1);expect(task).toMatchObject({status:'blocked'});expect(task.waitReason).toMatch(/未通过.*(检查|核实)/);expect(task.result).toBeUndefined();expect(task.help).toBeUndefined();expect(task.checkpoints).toBeUndefined();expect(task.resumeRequest).toBeUndefined();expect(task.runIds).toHaveLength(1);expect(saved.messages.filter(item=>item.kind==='help'||item.kind==='checkpoint'||item.kind==='result')).toEqual([]);expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(mode==='help'?5:8);
    const raw=await fs.readFile(path.join(f.user,entry.id,'dispatch','runs','tasks',task.taskId,task.runIds[0],'events.jsonl'),'utf8'),events=raw.trim().split('\n').map(line=>JSON.parse(line)),staged=events.filter(event=>event.type===stageType);expect(staged).toHaveLength(1);expect((staged[0].data.help??staged[0].data.checkpoint).binding).toMatchObject({...identity,taskId:task.taskId,runId:task.runIds[0]});
    const finishedStage=events.filter(event=>event.type==='tool.finished'&&event.data.id==='member-contract-stage');expect(finishedStage).toHaveLength(1);expect(finishedStage[0].data).toMatchObject({isError:true,receipt:{outcome:'failed',effects:['maintenance']},result:{content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]}});expect(JSON.stringify(finishedStage)).not.toContain('private-corrupt-member-output');expect(events.some(event=>event.type==='tool.denied'&&event.data.id==='member-contract-after-stage')).toBe(true);expect(events.some(event=>event.type==='tool.allowed'&&event.data.id==='member-contract-after-stage')).toBe(false);expect(events.filter(event=>event.type==='run.settled')).toEqual([expect.objectContaining({data:expect.objectContaining({status:'completed',acceptance:'not_evaluated'})})]);
    expect(events.filter(event=>event.type==='tool.finished'&&event.data.name==='read'&&event.data.receipt?.outcome==='succeeded')).toHaveLength(1);expect(events.filter(event=>event.type==='tool.finished'&&event.data.name==='write'&&event.data.receipt?.outcome==='succeeded')).toHaveLength(mode==='checkpoint'?1:0);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
    const sessionFile=events.find(event=>event.type==='session.bound')?.data.sessionFile;expect(typeof sessionFile).toBe('string');const native=(await fs.readFile(sessionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(native.find(item=>item.message?.toolCallId==='member-contract-stage')?.message).toMatchObject({isError:true,content:[{type:'text',text:expect.stringContaining('TOOL_OUTPUT_INVALID')}]});
    const counts={main:provider.main.length,member:provider.member.length},bytes=await mainToolContractLogBytes(f.user,entry.id),stat=await fs.stat(path.join(f.a,data.file));vi.restoreAllMocks();await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await graph()).toEqual(finished);expect(await records()).toEqual(saved);expect(await mainToolContractLogBytes(f.user,entry.id)).toEqual(bytes);expect((await fs.stat(path.join(f.a,data.file))).mtimeMs).toBe(stat.mtimeMs);expect({main:provider.main.length,member:provider.member.length}).toEqual(counts);expect(provider.errors).toEqual([]);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/member-tool-contract-${mode}-failure.json`,JSON.stringify({error:String(error),saveCalls,requests:{main:provider.main.length,member:provider.member.length},providerErrors:provider.errors,state:provider.state,lastMain:provider.main.at(-1)?.messages,lastMember:provider.member.at(-1)?.messages},null,2));throw error}
  finally{vi.restoreAllMocks();await app.shutdown();await f.cleanup();await provider.close()}
},90000);
