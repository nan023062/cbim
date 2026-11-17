// logic/execution/engines/pi: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkedRunInputSource,type HumanDecisionsSource} from '../../../../../../src/logic/execution/rules/input-source';
import {bridgeExtensionForSource} from '../../../../../../src/logic/execution/engines/pi/bridge';
import {LoopRuntime} from '../../../../../../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../../../../../../src/logic/execution/rules/types';
import {FileRunStorage} from '../../../../../../src/logic/execution/storage/run-storage';

const source=():HumanDecisionsSource=>({kind:'human_decisions',continuationId:'continuation',scopeId:'scope',waitId:'wait',inputRevision:2,decisionRevision:3,decisionIds:['decision-a','decision-b']});

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
