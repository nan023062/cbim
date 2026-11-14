import {runtimeToolGroup} from './runtime-tool-group';
import fs from 'node:fs/promises';
import path from 'node:path';
import {it,expect} from 'vitest';
import {transitionFixture,prepareTransition,transitionInput,transitionTool,runTransitions,finishTransitions,transitionContracts} from './artifact-transition-fixture';
import {invoke,deferred} from './artifact-runtime-fixture';
import {completeOutputProof} from '../src/logic/evidence/rules/complete-output-evidence';
import {workflowContractSchema} from '../src/logic/workspace/rules/workflow-contract';

it('真实删除与移动连续链贯通完整候选，保存前态与原阶段，文件字节不进入证明',async()=>{
  const f=await transitionFixture(async c=>{const manifestId=await runTransitions(c);const result=await finishTransitions(c,manifestId);expect(result.delivery.workflow.manifest.operations).toHaveLength(2)});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(f.apply).toHaveBeenCalledTimes(2);expect(f.drain).toHaveBeenCalled();const records=f.verify(summary.events).records;expect(records).toHaveLength(3);expect(records.map(r=>r.manifest.operations?.length??0)).toEqual([0,1,2]);expect(completeOutputProof(records[2]).operations).toHaveLength(2);expect(JSON.stringify(summary.events.filter(e=>e.type.startsWith('artifact.transition_')))).not.toContain('move unchanged');await expect(fs.lstat(path.join(f.directory,'outputs/old.txt'))).rejects.toMatchObject({code:'ENOENT'});await expect(fs.lstat(path.join(f.directory,'outputs/from.txt'))).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readFile(path.join(f.directory,'outputs/moved.txt'),'utf8')).toBe('\uFEFFmove unchanged\r\n')}finally{await f.cleanup()}
});
it('删除唯一文件根可交付零条目集合，但普通缺失或仅做一部分不构成证明',async()=>{
  const contracts=transitionContracts([{kind:'delete',path:'File.txt'}]);contracts[0].contract.artifactScope!.roots=[{kind:'file',path:'File.txt'}];
  const f=await transitionFixture(async c=>{const id=await runTransitions(c,1);await invoke(c,'cbim_task_step','step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['transition-0']});const result=await invoke(c,'cbim_delivery_prepare','delivery',{expectedVersion:3,manifestId:id,summary:'原文件已删除',limitations:[]});expect(result.delivery.workflow.manifest.entryCount).toBe(0)},{workflowContracts:contracts});
  try{expect((await(await f.start()).done).status).toBe('completed')}finally{await f.cleanup()}
  const partial=await transitionFixture(async c=>{await runTransitions(c,1)});try{const s=await(await partial.start()).done;expect(()=>completeOutputProof(partial.verify(s.events).records.at(-1)!)).toThrow()}finally{await partial.cleanup()}
});
it.each(['before','after','wire','prepared','executing','applied'] as const)('原操作 %s 异常保留只读屏障且不换调用重试',async mode=>{
  const f=await transitionFixture(async c=>{
    const manifestId=await prepareTransition(c),input=transitionInput(manifestId);if(mode==='before')await fs.writeFile(path.join(c.task.root,'outputs/new.txt'),'changed');
    expect((await c.beforeTool({name:transitionTool,id:'transition',input})).allow).toBe(true);
    let result:any;
    if(mode==='wire'){result=await runtimeToolGroup(c,'artifact-transitions')!.call(transitionTool,input,'transition');const value=JSON.parse(result.content[0].text);value.operation.beforeManifestId='forged';result.content[0].text=JSON.stringify(value)}else await expect(runtimeToolGroup(c,'artifact-transitions')!.call(transitionTool,input,'transition')).rejects.toThrow();
    await c.emit({type:'tool.finished',data:{name:transitionTool,id:'transition',isError:mode!=='wire',...(result?{result}:{})}});
    for(const name of [transitionTool,'write','cbim_delivery_prepare','cbim_task_manifest_capture','cbim_member_checkpoint'])expect((await c.beforeTool({name,id:'denied-'+name,input:name===transitionTool?input:{}})).allow).toBe(false);
    await invoke(c,'read','still-readable',{path:'File.txt'});
  },{afterAppend:async event=>{if(event.type==='artifact.transition_'+mode)throw Error('persist failed '+mode)},afterApply:mode==='after'?async()=>{await fs.writeFile(path.join(f.directory,'outputs/unexpected.txt'),'changed')}:undefined});
  try{const summary=await(await f.start()).done;expect(summary.status).toBe('interrupted');expect(summary.events.at(-1)?.data.unverifiedControlledCalls).toEqual(['transition']);expect(f.apply).toHaveBeenCalledTimes(['after','wire','applied'].includes(mode)?1:0);expect(summary.taskProgress?.delivery).toBeUndefined();expect(f.verify(summary.events).records.map(r=>r.manifest.operations)).toEqual([undefined])}finally{await f.cleanup()}
});
it.each(['source-returned','target-changed','extra-entry','ordinary-write','replan'] as const)('操作后 %s 不能沿用原证明或重做原操作',async mode=>{
  const f=await transitionFixture(async c=>{
    await runTransitions(c);if(mode==='source-returned')await fs.writeFile(path.join(c.task.root,'outputs/from.txt'),'returned');if(mode==='target-changed')await fs.writeFile(path.join(c.task.root,'outputs/moved.txt'),'changed');if(mode==='extra-entry')await fs.mkdir(path.join(c.task.root,'outputs/extra'));
    if(mode==='ordinary-write'){expect((await c.beforeTool({name:'write',id:'write',input:{path:'File.txt'}})).allow).toBe(true);await c.emit({type:'tool.finished',data:{id:'write',name:'write',result:{content:[{type:'text',text:'ok'}]}}})}
    if(mode==='replan')await invoke(c,'cbim_task_plan','replan',{expectedVersion:3,goal:c.task.goal,acceptance:c.task.acceptance,reason:'新计划',steps:[{id:'verify',title:'检查',owner:'当前成员'}]});
    const version=['ordinary-write','replan'].includes(mode)?4:3,captured=await invoke(c,'cbim_task_manifest_capture','changed',{expectedTaskProgressVersion:version});expect(captured.manifest.operations).toBeUndefined();expect((await c.beforeTool({name:transitionTool,id:'repeat',input:transitionInput(captured.manifest.manifestId,0,version)})).allow).toBe(false);
  });try{const summary=await(await f.start()).done;expect(f.apply).toHaveBeenCalledTimes(2);expect(()=>completeOutputProof(f.verify(summary.events).records.at(-1)!)).toThrow()}finally{await f.cleanup()}
});
it('仅模型伪造阶段、缺真实端口或完整出口声明均不能取得执行资格',async()=>{
  const f=await transitionFixture(async c=>{await expect(c.emit({type:'artifact.transition_applied',data:{}})).rejects.toThrow('可信端口');await expect(c.emit({type:'tool.allowed',data:{id:'forged',name:transitionTool}})).rejects.toThrow();await expect(runtimeToolGroup(c,'artifact-transitions')!.call(transitionTool,transitionInput('made-up'),'forged')).rejects.toMatchObject({code:'ARTIFACT_TRANSITION_AUTHORIZATION'})});try{expect((await(await f.start()).done).status).toBe('completed');expect(f.apply).not.toHaveBeenCalled()}finally{await f.cleanup()}
  const missing=await transitionFixture(async()=>{}, {transitionPort:undefined});try{await expect(missing.start()).rejects.toMatchObject({code:'ARTIFACT_TRANSITION_UNAVAILABLE'})}finally{await missing.cleanup()}
  const contract=transitionContracts()[0].contract;delete contract.delivery;expect(workflowContractSchema.safeParse(contract).success).toBe(false);
});
it('执行阶段已保存后停止，等待真实句柄退出，原文件不删除也不重新发出',async()=>{
  const entered=deferred(),release=deferred();
  const f=await transitionFixture(async c=>{const input=transitionInput(await prepareTransition(c));expect((await c.beforeTool({name:transitionTool,id:'stopped',input})).allow).toBe(true);await expect(runtimeToolGroup(c,'artifact-transitions')!.call(transitionTool,input,'stopped')).rejects.toThrow();await c.emit({type:'tool.finished',data:{id:'stopped',name:transitionTool,isError:true}})},{beforeApply:async()=>{entered.resolve();await release.promise}});
  try{const run=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await run.done;expect(summary.status).toBe('interrupted');expect(summary.events.filter(e=>e.type.startsWith('artifact.transition_')).map(e=>e.type)).toEqual(['artifact.transition_prepared','artifact.transition_executing']);expect(f.apply).not.toHaveBeenCalled();expect(await fs.readFile(path.join(f.directory,'outputs/old.txt'),'utf8')).toBe('remove this');expect(f.drain).toHaveBeenCalled()}finally{release.resolve();await f.cleanup()}
});
it('实际 IO 和 finished 均完成前阻止并发，提前伪成功结束不能释放屏障',async()=>{
  const entered=deferred(),release=deferred();
  const f=await transitionFixture(async c=>{const input=transitionInput(await prepareTransition(c));expect((await c.beforeTool({name:transitionTool,id:'early',input})).allow).toBe(true);const pending=runtimeToolGroup(c,'artifact-transitions')!.call(transitionTool,input,'early');await entered.promise;await c.emit({type:'tool.finished',data:{name:transitionTool,id:'early',result:{content:[{type:'text',text:'{}'}]}}});expect((await c.beforeTool({name:'read',id:'concurrent',input:{path:'File.txt'}})).allow).toBe(false);release.resolve();await expect(pending).rejects.toThrow();expect((await c.beforeTool({name:'write',id:'later',input:{path:'File.txt'}})).allow).toBe(false);await invoke(c,'read','after-ended',{path:'File.txt'})},{afterOpen:async()=>{entered.resolve();await release.promise}});
  try{expect((await(await f.start()).done).status).toBe('interrupted');expect(f.apply).not.toHaveBeenCalled()}finally{release.resolve();await f.cleanup()}
});
