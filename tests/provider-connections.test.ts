import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definition,type LlmDefinition,type LlmProfile} from '../src/backend/core/models/config';
import {connectionForEngine,providerSupportsEngine} from '../src/backend/core/models/provider-connections';
import {identifyProvider} from '../src/backend/core/models/provider-presets';
import {EngineModelPicker} from '../src/frontend/components/EngineModelPicker';
import {ProviderConnections,ProviderConnectionTest,connectionTestNotice} from '../src/frontend/settings/ProviderConnections';

const profile:LlmProfile={id:'11111111-1111-4111-8111-111111111111',name:'DeepSeek',api:'openai-completions',baseUrl:'https://api.deepseek.com/v1',auth:'api-key',hasKey:true,defaultModel:'deepseek-flash',models:[{id:'deepseek-flash',name:'Flash',enabled:true,reasoning:true,contextWindow:1048576,maxTokens:4096}]};

test('旧 DeepSeek 配置无需修改即可按三引擎选接口，Pi 和模型身份保持原值',()=>{
  const original=JSON.stringify(profile);
  expect(connectionForEngine(profile,'pi',profile.defaultModel)).toEqual({api:'openai-completions',baseUrl:profile.baseUrl,source:'primary'});
  expect(connectionForEngine(profile,'claude-code',profile.defaultModel)).toEqual({api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic',source:'preset'});
  expect(connectionForEngine(profile,'codex',profile.defaultModel)).toEqual({api:'openai-responses',baseUrl:'https://api.deepseek.com',source:'preset'});
  expect(JSON.stringify(profile)).toBe(original);
  for(const engine of ['pi','claude-code','codex'] as const){
    const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:true,profiles:[profile]},initialEngine:engine,onChange:()=>{}}));
    expect(html).toContain('DeepSeek / Flash');expect(html).not.toContain('当前没有与');
  }
});

test.each(['https://api.deepseek.com.evil.example/v1','https://proxy.example/deepseek','http://api.deepseek.com','https://user:secret@api.deepseek.com','https://api.deepseek.com/v1?token=secret','https://api.deepseek.com/v1#fragment','https://api.deepseek.com/beta','https://api.deepseek.com:8443/v1','https://api.moonshot.cn/v1'])('不根据模型品牌或近似域名推导凭据目标：%s',baseUrl=>{
  expect(identifyProvider(baseUrl)).toBeUndefined();
  expect(connectionForEngine({...profile,baseUrl},'claude-code',profile.defaultModel)).toBeUndefined();
});

test('官方地址可识别尾斜线，关闭自动识别后保留主接口，显式接口优先且型号限制不会回退预设',()=>{
  expect(identifyProvider('https://API.DEEPSEEK.COM/v1/')).toMatchObject({id:'deepseek'});
  expect(connectionForEngine({...profile,autoDetect:false},'claude-code',profile.defaultModel)).toBeUndefined();
  expect(connectionForEngine({...profile,autoDetect:false},'pi',profile.defaultModel)?.baseUrl).toBe(profile.baseUrl);
  const explicit:LlmDefinition={...profile,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://gateway.example/anthropic',modelIds:['deepseek-flash']}]};
  expect(connectionForEngine(explicit,'claude-code','deepseek-flash')).toMatchObject({source:'explicit',baseUrl:'https://gateway.example/anthropic'});
  expect(connectionForEngine(explicit,'claude-code','different-model')).toBeUndefined();
  expect(connectionForEngine({...explicit,autoDetect:false},'claude-code','deepseek-flash')?.source).toBe('explicit');
});

test('MiniMax 兼容接口仅列出声明型号；自定义模型 ID 不因名字像 Claude 而获得兼容性',()=>{
  const minimax={...profile,name:'MiniMax',baseUrl:'https://api.minimax.io/v1',models:[{...profile.models[0],id:'MiniMax-M3'},{...profile.models[0],id:'legacy',name:'Legacy'}]};
  expect(providerSupportsEngine('claude-code',minimax,'MiniMax-M3')).toBe(true);
  expect(providerSupportsEngine('claude-code',minimax,'legacy')).toBe(false);
  expect(providerSupportsEngine('codex',minimax,'MiniMax-M3')).toBe(false);
  const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:true,profiles:[minimax]},initialEngine:'claude-code',onChange:()=>{}}));
  expect(html).toContain('MiniMax / Flash');expect(html).not.toContain('MiniMax / Legacy');
  expect(providerSupportsEngine('claude-code',{...profile,baseUrl:'https://custom.example/v1'},'claude-custom')).toBe(false);
});

test('接口 schema 拒绝重复协议、未知型号与不安全地址，旧配置不补自动字段',()=>{
  const {id:_id,hasKey:_hasKey,...legacy}=profile;
  expect(definition.parse(legacy)).toEqual(legacy);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'openai-completions',baseUrl:'https://other.example/v1'}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'http://external.example'}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://other.example',modelIds:['unknown']}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://other.example',modelIds:[]}]}).success).toBe(false);
});

test('设置预览展示实际推导端点，测试菜单只列可用引擎，渲染不会执行测试',()=>{
  let calls=0;
  const html=renderToStaticMarkup(createElement(ProviderConnections,{value:profile,onChange:()=>{calls++}}));
  expect(html).toContain('已识别 DeepSeek');expect(html).toContain('https://api.deepseek.com/anthropic');expect(html).toContain('自定义兼容接口');
  const custom={...profile,baseUrl:'https://custom.example/v1'};
  const tests=renderToStaticMarkup(createElement(ProviderConnectionTest,{profile:custom,busy:false,onTest:()=>{calls++}}));
  expect(tests).toMatch(/<option value="claude-code" disabled/);expect(tests).toMatch(/<option value="codex" disabled/);expect(calls).toBe(0);
  expect(connectionTestNotice('DeepSeek',{ok:true,model:'deepseek-flash',latencyMs:10,engine:'claude-code',api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'})).toContain('Anthropic Messages，仅文本请求');
});
