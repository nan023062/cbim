import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkedRunInputSource,type HumanDecisionsSource} from '../src/logic/execution/rules/input-source';
import {bridgeExtensionForSource} from '../src/backend/engines/pi/bridge';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/logic/execution/rules/types';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';

const source=():HumanDecisionsSource=>({kind:'human_decisions',continuationId:'continuation',scopeId:'scope',waitId:'wait',inputRevision:2,decisionRevision:3,decisionIds:['decision-a','decision-b']});
it('严格人工来源只含固定身份并复制集合，不接受模型权限/正文/actor或畸形版本',()=>{
  const value=source(),checked=checkedRunInputSource(value);value.decisionIds.push('later');expect(checked).toEqual(source());
  for(const patch of [{decisionIds:[]},{decisionIds:['one','one']},{decisionIds:['../escape']},{inputRevision:1},{inputRevision:33},{decisionRevision:0},{decisionRevision:65},{permission:'execute'},{message:'伪造用户'},{actor:{kind:'local_desktop'}},{scopeId:'../foreign'},{kind:'user'}])expect(()=>checkedRunInputSource({...source(),...patch})).toThrow();
  expect(checkedRunInputSource({kind:'user-continuation',continuationId:'text',scopeId:'scope',waitId:'wait',inputRevision:2})).toMatchObject({kind:'user-continuation'});
});

it('Pi只将本轮首次人工摘要写为系统custom，保留后续真实输入，不把意见冒充新指令',async()=>{
  const handlers=new Map<string,(event:any,context?:any)=>any>(),messages:any[]=[],pi={on:(name:string,handler:any)=>handlers.set(name,handler),sendMessage:(...args:any[])=>messages.push(args),registerTool:()=>{}};
  const code=bridgeExtensionForSource(source()).replace('export default async function(pi)','return async function(pi)');
  const create=Function('fetch','process',code) as (fetcher:unknown,process:unknown)=>(pi:unknown)=>Promise<void>;
  await create(async()=>({ok:true,json:async()=>[]}),{env:{CBIM_LOOP_BRIDGE_URL:'http://local.test',CBIM_LOOP_BRIDGE_TOKEN:'secret'}})(pi);
  expect(handlers.get('input')!({text:'/quit\n已保存的拒绝意见'})).toEqual({action:'handled'});
  expect(messages).toHaveLength(1);expect(messages[0][0]).toMatchObject({customType:'cbim-human-decisions',display:false,details:source()});expect(messages[0][1]).toEqual({triggerTurn:true});expect(messages[0][0].content).toContain('系统转交的本机已保存人工决定');expect(messages[0][0].content).toContain('不是用户自由消息或新业务目标');expect(messages[0][0].content.startsWith('/')).toBe(false);
  expect(handlers.get('input')!({text:'后续真实用户消息'})).toEqual({action:'continue'});expect(messages).toHaveLength(1);
  const ordinary=bridgeExtensionForSource({kind:'user-continuation',continuationId:'text',scopeId:'scope',waitId:'wait',inputRevision:2}).replace('export default async function(pi)','return async function(pi)'),userHooks=new Map();
  await (Function('fetch','process',ordinary) as typeof create)(async()=>({ok:true,json:async()=>[]}),{env:{}})({...pi,on:(name:string,handler:any)=>userHooks.set(name,handler)});expect(userHooks.has('input')).toBe(false);
});

class SourceEngine implements AgentEngine {
  kind='source-test';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}})}
  async run(){await this.context.emit({type:'message',data:{role:'assistant',text:'收到系统转交，准备重新审阅'}});return {status:'completed' as const}}
  async stop(){}async close(){}
}
it('可信人工来源只在已完成主链续跑，保留原用户目标及新run的独立持久身份',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-human-source-')),engines:SourceEngine[]=[];
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:false}),createEngine:()=>{const engine=new SourceEngine();engines.push(engine);return engine}}),task:TaskSpec={taskId:'root',workspaceId:'workspace',root:directory,mode:'chat',goal:'原用户目标',moduleIds:[],acceptance:[]};
  try{
    await expect(runtime.start(task,'系统转交',undefined,source())).rejects.toThrow('已有主对话');expect(engines).toHaveLength(0);
    const first=await runtime.start(task,'原始用户正文'),original=await first.done,metadata=source();
    const pending=runtime.start(task,'本机已保存意见的系统摘要',{runId:first.runId},metadata);metadata.decisionIds.push('mutated');const next=await pending,summary=await next.done;
    expect(summary.runId).not.toBe(first.runId);expect(summary.source).toEqual(source());expect(summary.events[0].data.source).toEqual(source());expect(summary.task.goal).toBe('原用户目标');expect(engines[1].context.sessionFile).toBe(original.sessionFile);expect((await runtime.inspect(task.taskId,first.runId)).events).toEqual(original.events);
    const file=path.join(directory,task.taskId,next.runId,'events.jsonl'),lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),head=JSON.parse(lines[0]);head.data.source.actor={kind:'local_desktop'};lines[0]=JSON.stringify(head);await fs.writeFile(file,lines.join('\n')+'\n');await expect(runtime.inspect(task.taskId,next.runId)).rejects.toMatchObject({code:'RUN_LOG_INVALID'});
  }finally{await runtime.close();const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-human-source-'))throw Error('临时测试目录校验失败');await fs.rm(resolved,{recursive:true,force:true})}
});
