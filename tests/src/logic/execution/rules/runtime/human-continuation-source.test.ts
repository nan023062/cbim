import { fixtureEngines } from '../../../../../support/engine-instances';
// logic/execution/rules/runtime: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkedRunInputSource,type HumanDecisionsSource} from '../../../../../../src/logic/execution/rules/input-source';
import {bridgeExtensionForSource} from '../../../../../../src/logic/engines/adapters/pi/bridge';
import {LoopRuntime} from '../../../../../../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../../../../../../src/logic/execution/rules/types';
import {FileRunStorage} from '../../../../../../src/logic/execution/storage/run-storage';

const source=():HumanDecisionsSource=>({kind:'human_decisions',continuationId:'continuation',scopeId:'scope',waitId:'wait',inputRevision:2,decisionRevision:3,decisionIds:['decision-a','decision-b']});

class SourceEngine implements AgentEngine {
  kind='source-test';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}})}
  async run(){await this.context.emit({type:'message',data:{role:'assistant',text:'收到系统转交，准备重新审阅'}});return {status:'completed' as const}}
  async stop(){}async close(){}
}
it('可信人工来源只在已完成主链续跑，保留原用户目标及新run的独立持久身份',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-human-source-')),engines:SourceEngine[]=[];
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),AcquireLease:async()=>()=>{},ToolPolicy:async()=>({allow:false}),engines:fixtureEngines(()=>{const engine=new SourceEngine();engines.push(engine);return engine})}),task:TaskSpec={taskId:'root',workspaceId:'workspace',root:directory,mode:'chat',goal:'原用户目标',moduleIds:[],acceptance:[]};
  try{
    await expect(runtime.Start(task,'系统转交',undefined,source())).rejects.toThrow('已有主对话');expect(engines).toHaveLength(0);
    const first=await runtime.Start(task,'原始用户正文'),original=await first.done,metadata=source();
    const pending=runtime.Start(task,'本机已保存意见的系统摘要',{runId:first.runId},metadata);metadata.decisionIds.push('mutated');const next=await pending,summary=await next.done;
    expect(summary.runId).not.toBe(first.runId);expect(summary.source).toEqual(source());expect(summary.events[0].data.source).toEqual(source());expect(summary.task.goal).toBe('原用户目标');expect(engines[1].context.sessionFile).toBe(original.sessionFile);expect((await runtime.Inspect(task.taskId,first.runId)).events).toEqual(original.events);
    const file=path.join(directory,task.taskId,next.runId,'events.jsonl'),lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),head=JSON.parse(lines[0]);head.data.source.actor={kind:'local_desktop'};lines[0]=JSON.stringify(head);await fs.writeFile(file,lines.join('\n')+'\n');await expect(runtime.Inspect(task.taskId,next.runId)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});
  }finally{await runtime.Close();const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-human-source-'))throw Error('临时测试目录校验失败');await fs.rm(resolved,{recursive:true,force:true})}
});
