import {runtimeTools} from './runtime-tools-fixture';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {EngineContext,ToolDecision} from '../src/backend/core/brain';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import {validationTool} from '../src/backend/core/tasks/validation-tools';
import type {ValidationInput,ValidationResult} from '../src/backend/core/tasks/validation';
import {verifyValidationRecords} from '../src/backend/core/tasks/validation-evidence';
import {artifactRuntimeFixture,artifactBinding,seedProgress,invoke,captureInput,deferred} from './artifact-runtime-fixture';

const bindings:WorkflowContractBinding[]=[{moduleId:'.cbim/workspace/module',workflowId:'workflow',workflowVersion:'version-one',contract:{version:1,delivery:{requiredValidations:[{id:'json-result',validator:'json-schema-v1',artifactPath:'File.txt',schema:{type:'object',properties:{count:{type:'integer',minimum:1}},required:['count'],additionalProperties:false}}]}}}];
const descriptor=(name:string)=>({effects:(['read','cbim_validation_run'].includes(name)?['read']:name==='write'?['business-write']:['maintenance']) as ToolDecision['effects'],native:false});
async function fixture(work:(c:EngineContext)=>Promise<void>,options:Parameters<typeof artifactRuntimeFixture>[1]={}){
  const f=await artifactRuntimeFixture(work,{workflowContracts:bindings,describeTool:call=>validationTool(call.name,call.input)??{...descriptor(call.name),effects:descriptor(call.name).effects!},policy:async name=>({allow:true,...descriptor(name),scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}),...options});
  await fs.writeFile(path.join(f.directory,'File.txt'),'{"count":1}');return f;
}
async function prepare(c:EngineContext){await seedProgress(c);const base=await invoke(c,'cbim_task_artifact_capture','capture',captureInput);return {moduleId:bindings[0].moduleId,requirementId:'json-result',baselineId:base.baseline.baselineId,expectedTaskProgressVersion:1}}
async function done(c:EngineContext){await invoke(c,'cbim_task_step','step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['validation']})}
async function failed(c:EngineContext,name:string,id:string,input:Record<string,unknown>,code:string){
  expect((await c.beforeTool({name,id,input})).allow).toBe(true);
  const error=await (name==='cbim_validation_run'?runtimeTools(c).validationTools!.call(name,input,id):runtimeTools(c).taskTools!.call(name,input)).catch(error=>error);expect(error.code).toBe(code);
  await c.emit({type:'tool.finished',data:{name,id,isError:true,result:{content:[{type:'text',text:error.message}]}}});
}

it('正式成员按同轮基线保存真实通过记录，步骤增版后仍可用并在交付时重核字节',async()=>{
  const f=await fixture(async c=>{
    const input=await prepare(c),result=await invoke(c,'cbim_validation_run','validation',input);expect(result.validation.outcome).toBe('passed');expect(result.validation.binding).toEqual(artifactBinding);
    await done(c);const candidate=await invoke(c,'cbim_delivery_prepare','delivery',{expectedVersion:2,summary:'JSON 结构满足冻结要求',limitations:[]});expect(candidate.delivery.workflow.validationChecks).toHaveLength(1);
  });try{
    const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(f.validateFile).toHaveBeenCalledTimes(1);expect(f.checkValidationFiles).toHaveBeenCalledTimes(1);
    const records=verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',bindings,f.port.normalizePath);expect(records).toHaveLength(1);expect(records[0].receipt).toMatchObject({outcome:'succeeded',effects:['read']});expect(records[0].checkedSeq).toBeLessThan(records[0].finishedSeq);
  }finally{await f.cleanup()}
});

it('结构拒绝是可追溯的 succeeded 验证事实，但步骤引用不能把 rejected 变成 Workflow 通过',async()=>{
  const f=await fixture(async c=>{const input=await prepare(c);expect((await invoke(c,'cbim_validation_run','validation',input)).validation.outcome).toBe('rejected');await done(c);await failed(c,'cbim_delivery_prepare','delivery',{expectedVersion:2,summary:'不能交付',limitations:[]},'WORKFLOW_VALIDATION_REQUIRED')});
  try{await fs.writeFile(path.join(f.directory,'File.txt'),'{"count":"bad"}');const summary=await (await f.start()).done;expect(summary.taskProgress?.delivery).toBeUndefined();expect(summary.taskProgress?.version).toBe(2);const records=verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',bindings,f.port.normalizePath);expect(records[0]).toMatchObject({result:{outcome:'rejected'},receipt:{outcome:'succeeded'}})}finally{await f.cleanup()}
});

it('验证实际读取期间封住并发工具，停止会中止端口且不产生通过事件',async()=>{
  const entered=deferred(),release=deferred();let signalAborted=false;const f=await fixture(async c=>{
    const input=await prepare(c);expect((await c.beforeTool({name:'cbim_validation_run',id:'validation',input})).allow).toBe(true);
    const work=runtimeTools(c).validationTools!.call('cbim_validation_run',input,'validation').then(()=>undefined,error=>error as Error);await entered.promise;
    for(const name of ['read','write','cbim_task_artifact_capture','cbim_task_help'])expect((await c.beforeTool({name,id:'concurrent-'+name,input:{}})).allow).toBe(false);
    expect((await work)?.message).toContain('停止');await c.emit({type:'tool.finished',data:{name:'cbim_validation_run',id:'validation',isError:true,result:{content:[{type:'text',text:'stopped'}]}}});
  });f.validateFile.mockImplementation(async(_file,_schema,signal)=>{entered.resolve();await release.promise;signalAborted=signal.aborted;signal.throwIfAborted();throw Error('missing abort')});
  try{const run=await f.start();await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();const summary=await run.done;expect(summary.status).toBe('cancelled');expect(signalAborted).toBe(true);expect(summary.events.some(event=>event.type==='validation.checked')).toBe(false)}finally{release.resolve();await f.cleanup()}
});

it('交付复核持独立短锁，异步读取期间写入不能越过，结束后释放且不改验证事实',async()=>{
  const entered=deferred(),release=deferred();const f=await fixture(async c=>{
    await invoke(c,'cbim_validation_run','validation',await prepare(c));await done(c);const args={expectedVersion:2,summary:'结构满足',limitations:[]};expect((await c.beforeTool({name:'cbim_delivery_prepare',id:'delivery',input:args})).allow).toBe(true);
    const work=runtimeTools(c).taskTools!.call('cbim_delivery_prepare',args);await entered.promise;expect((await c.beforeTool({name:'write',id:'racing-write',input:{path:'File.txt',content:'bad'}})).allow).toBe(false);release.resolve();const result=await work;await c.emit({type:'tool.finished',data:{name:'cbim_delivery_prepare',id:'delivery',result}});await invoke(c,'read','after-delivery',{path:'File.txt'});
  });f.checkValidationFiles.mockImplementation(async(files,signal)=>{entered.resolve();await release.promise;return f.filePort.checkFiles(files,signal)});
  try{expect((await (await f.start()).done).taskProgress?.state).toBe('awaiting_review')}finally{release.resolve();await f.cleanup()}
});

it('验证后文件变化或核实期间知识变化都不能保存交付或新的通过事实',async()=>{
  const changed=await fixture(async c=>{await invoke(c,'cbim_validation_run','validation',await prepare(c));await done(c);await fs.writeFile(path.join(c.task.root,'File.txt'),'{"count":2}');await failed(c,'cbim_delivery_prepare','delivery',{expectedVersion:2,summary:'旧文件证明',limitations:[]},'VALIDATION_ARTIFACT_CHANGED')});
  try{const summary=await (await changed.start()).done;expect(summary.taskProgress?.version).toBe(2);expect(summary.taskProgress?.delivery).toBeUndefined()}finally{await changed.cleanup()}
  const knowledge=await fixture(async c=>{const input=await prepare(c);knowledge.knowledge.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('知识变化'));expect((await c.beforeTool({name:'cbim_validation_run',id:'validation',input})).allow).toBe(true);await expect(runtimeTools(c).validationTools!.call('cbim_validation_run',input,'validation')).rejects.toThrow('知识变化');await c.emit({type:'tool.finished',data:{name:'cbim_validation_run',id:'validation',isError:true,result:{content:[{type:'text',text:'knowledge changed'}]}}})});
  try{expect((await (await knowledge.start()).done).events.some(event=>event.type==='validation.checked')).toBe(false)}finally{await knowledge.cleanup()}
});

it('验证已落盘后坏回包不产生可信记录，不自动重试并由真实失败结束释放短锁',async()=>{
  const f=await fixture(async c=>{
    const input=await prepare(c),tool=runtimeTools(c).validationTools as unknown as {port:{run(input:ValidationInput,id:string):Promise<ValidationResult>}},run=tool.port.run;
    tool.port.run=vi.fn(async(input,id)=>({...await run(input,id),binding:{...artifactBinding,agentSessionId:'wrong'}}));
    await failed(c,'cbim_validation_run','validation',input,'TOOL_OUTPUT_INVALID');expect(tool.port.run).toHaveBeenCalledTimes(1);await invoke(c,'read','after-failure',{path:'File.txt'});
  });try{const summary=await (await f.start()).done;expect(summary.events.filter(event=>event.type==='validation.checked')).toHaveLength(1);expect(verifyValidationRecords(summary.events,artifactBinding,'knowledge-one',bindings,f.port.normalizePath)).toEqual([]);expect(f.validateFile).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});

it('无冻结要求或普通主运行不注册验证，缺端口声明拒绝启动，模型不能直接写验证事件',async()=>{
  const absent=await artifactRuntimeFixture(async c=>{expect(runtimeTools(c).validationTools).toBeUndefined();expect((await c.beforeTool({name:'cbim_validation_run',id:'forged',input:{}})).allow).toBe(false);await expect(c.emit({type:'validation.checked',data:{validation:{outcome:'passed'}}})).rejects.toThrow('可信端口')});
  try{await (await absent.runtime.start({...absent.task,mode:'chat',agentId:'cbim:main'})).done;expect(absent.validateFile).not.toHaveBeenCalled()}finally{await absent.cleanup()}
  const missing=await fixture(async()=>{throw Error('should not run')},{validationPort:false});try{await expect(missing.start()).rejects.toMatchObject({code:'VALIDATION_UNAVAILABLE'});expect(missing.validateFile).not.toHaveBeenCalled()}finally{await missing.cleanup()}
});

it('跨模块验证要求超过本轮记录容量时在创建模型和日志前明确拒绝',async()=>{
  const requirement=bindings[0].contract.delivery!.requiredValidations![0];
  const many:WorkflowContractBinding[]=bindings.map(binding=>({...binding,contract:{version:1,delivery:{requiredValidations:Array.from({length:16},(_,index)=>({...requirement,id:'requirement-'+index}))}}}));
  many.push({...structuredClone(bindings[0]),moduleId:'.cbim/workspace/other-module'});
  const work=vi.fn(async()=>{}),f=await fixture(work,{workflowContracts:many});
  try{await expect(f.start()).rejects.toMatchObject({code:'WORKFLOW_VALIDATION_LIMIT'});expect(work).not.toHaveBeenCalled();expect(f.validateFile).not.toHaveBeenCalled()}finally{await f.cleanup()}
});
