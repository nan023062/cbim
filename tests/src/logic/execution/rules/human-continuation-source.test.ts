// logic/execution/rules: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkedRunInputSource,type HumanDecisionsSource} from '../../../../../src/logic/execution/rules/input-source';
import {bridgeExtensionForSource} from '../../../../../src/logic/engines/adapters/pi/bridge';
import {LoopRuntime} from '../../../../../src/logic/execution/rules/runtime/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../../../../../src/logic/execution/rules/types';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';

const source=():HumanDecisionsSource=>({kind:'human_decisions',continuationId:'continuation',scopeId:'scope',waitId:'wait',inputRevision:2,decisionRevision:3,decisionIds:['decision-a','decision-b']});
it('严格人工来源只含固定身份并复制集合，不接受模型权限/正文/actor或畸形版本',()=>{
  const value=source(),checked=checkedRunInputSource(value);value.decisionIds.push('later');expect(checked).toEqual(source());
  for(const patch of [{decisionIds:[]},{decisionIds:['one','one']},{decisionIds:['../escape']},{inputRevision:1},{inputRevision:33},{decisionRevision:0},{decisionRevision:65},{permission:'execute'},{message:'伪造用户'},{actor:{kind:'local_desktop'}},{scopeId:'../foreign'},{kind:'user'}])expect(()=>checkedRunInputSource({...source(),...patch})).toThrow();
  expect(checkedRunInputSource({kind:'user-continuation',continuationId:'text',scopeId:'scope',waitId:'wait',inputRevision:2})).toMatchObject({kind:'user-continuation'});
});

class SourceEngine implements AgentEngine {
  kind='source-test';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:context.sessionFile??path.join(context.directory,'native.jsonl')}})}
  async run(){await this.context.emit({type:'message',data:{role:'assistant',text:'收到系统转交，准备重新审阅'}});return {status:'completed' as const}}
  async stop(){}async close(){}
}
