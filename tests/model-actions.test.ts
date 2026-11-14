import {expect,test,vi} from 'vitest';
import {modelActionSchemas,isModelAction} from '../src/bridge/contracts/model-actions';
import type {Bridge} from '../src/bridge/contracts/workspace';
import {fixture} from './helpers';

// 编译期反例保证已迁移路由不会借旧的宽泛重载绕过请求/返回映射；不在运行时执行。
async function contractTypes(bridge:Bridge){
  const settings=await bridge.call('models.list');settings.profiles.map(profile=>profile.id);
  // @ts-expect-error 响应不能暴露明文凭据。
  settings.apiKey;
  // @ts-expect-error 模型选择必须明确提供 id。
  bridge.call('models.select',{});
  // @ts-expect-error 主 Agent 保存必须有完整工作区身份、revision 与选型。
  bridge.call('agent.configureMain',{engine:'pi'});
  // @ts-expect-error 未登记操作不能使用固定 IPC 入口。
  bridge.call('models.arbitraryCommand',{});
  // @ts-expect-error 主配置读取不能省略参数。
  bridge.call('agent.mainSettings');
}

test('请求目录只承认精确 action，列表与身份读取不接额外私有字段',()=>{
  expect(isModelAction('models.list')).toBe(true);expect(isModelAction('constructor')).toBe(false);expect(isModelAction('models.arbitraryCommand')).toBe(false);
  expect(modelActionSchemas['models.list'].safeParse({apiKey:'unwanted'}).success).toBe(false);
  expect(modelActionSchemas['agent.mainSettings'].safeParse({workspaceId:'a'.repeat(64),instanceId:'bad'}).success).toBe(false);
  const id='11111111-1111-4111-8111-111111111111';
  expect(modelActionSchemas['models.test'].parse({id,engine:'claude-code'})).toEqual({id,engine:'claude-code'});
  expect(modelActionSchemas['models.test'].safeParse({id,engine:'other'}).success).toBe(false);
  expect(modelActionSchemas['models.test'].safeParse({id,baseUrl:'https://unexpected.example'}).success).toBe(false);
  expect(modelActionSchemas['models.testConnection'].parse({id,kind:'embedding',modelId:'vector'})).toEqual({id,kind:'embedding',modelId:'vector'});
  expect(modelActionSchemas['models.testConnection'].safeParse({id,kind:'generation',modelId:'chat'}).success).toBe(false);
  expect(modelActionSchemas['models.testConnection'].safeParse({id,kind:'embedding',modelId:'vector',engine:'pi'}).success).toBe(false);
});

test('实际 IPC 将测试引擎和型号交给同一配置服务',async()=>{
  const f=await fixture(),id='11111111-1111-4111-8111-111111111111';
  const receipt={ok:true,model:'test',engine:'claude-code' as const,api:'anthropic-messages' as const,baseUrl:'https://example.com',latencyMs:1};
  const probe=vi.spyOn(f.app.engineModels,'test').mockResolvedValue(receipt);
  try{
    expect(await f.app.dispatch('models.test',{id,modelId:'test',engine:'claude-code'})).toEqual(receipt);
    expect(probe).toHaveBeenCalledExactlyOnceWith(id,'test','claude-code');
  }finally{probe.mockRestore();await f.cleanup()}
});

test('实际 Application 先校验模型请求，失败不调用配置写入服务',async()=>{
  const f=await fixture(),save=vi.spyOn(f.app.models,'save'),select=vi.spyOn(f.app.models,'select');
  try{
    await expect(f.app.dispatch('models.save',{profile:{},program:'unexpected'})).rejects.toThrow();
    await expect(f.app.dispatch('models.select',{})).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();
    expect(await f.app.dispatch('models.list')).toMatchObject({profiles:[]});
    await expect(f.app.dispatch('models.arbitraryCommand',{})).rejects.toMatchObject({code:'ACTION'});
  }finally{save.mockRestore();select.mockRestore();await f.cleanup()}
});
