import {expect,test} from 'vitest';
import {supportedEngines,engineDescriptor,engineModelRequirement,engineSupportsApi,loopEngineSchema,connectionForEngine} from '../../../../src/logic/engines';

test('静态清单统一提供身份、显示名和业务类型；外部不能追加引擎或改变协议',()=>{
  expect(supportedEngines.map(engine=>engine.id)).toEqual(['pi','claude-code','codex','memory']);
  expect(loopEngineSchema.options).toEqual(supportedEngines.map(engine=>engine.id));
  expect(new Set(supportedEngines.map(engine=>engine.id)).size).toBe(supportedEngines.length);
  expect(Object.isFrozen(supportedEngines)).toBe(true);
  for(const item of supportedEngines){
    expect(item.label).not.toBe('');expect(item.businessTypes.length).toBeGreaterThan(0);
    expect(Object.isFrozen(item)).toBe(true);expect(Object.isFrozen(item.businessTypes)).toBe(true);expect(Object.isFrozen(item.supportedApis)).toBe(true);
    expect(engineDescriptor(item.id)).toBe(item);
  }
  expect(loopEngineSchema.safeParse('user-plugin')).toMatchObject({success:false});
  expect(()=>engineDescriptor('user-plugin' as never)).toThrow();
});

test.each([
  ['pi',['openai-completions','openai-responses','anthropic-messages'],undefined],
  ['claude-code',['anthropic-messages'],'anthropic-messages'],
  ['codex',['openai-responses'],'openai-responses'],
] as const)('%s 的协议声明同时用于兼容筛选与模型需求',(engine,apis,fallbackApi)=>{
  expect(engineModelRequirement(engine)).toEqual({supportedApis:apis,fallbackApi});
  for(const api of ['openai-completions','openai-responses','anthropic-messages','embedding','unknown'])expect(engineSupportsApi(engine,api)).toBe(apis.some(value=>value===api));
});

test('引擎兼容规则优先保留主接口；未知供应商不猜地址或改写模型 ID',()=>{
  const profile={api:'openai-completions' as const,baseUrl:'https://custom.example/v1'};
  expect(connectionForEngine(profile,'pi','custom/model')).toEqual({...profile,source:'primary'});
  expect(connectionForEngine(profile,'claude-code','custom/model')).toBeUndefined();
  expect(connectionForEngine({...profile,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://custom.example/messages',modelIds:['custom/model']}]},'claude-code','custom/model')).toMatchObject({source:'explicit',api:'anthropic-messages'});
  expect(connectionForEngine(profile,'codex','custom/model')).toBeUndefined();
});
