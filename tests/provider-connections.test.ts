import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definition,type LlmDefinition,type LlmProfile} from '../src/logic/models';
import {connectionForEngine,providerSupportsEngine} from '../src/logic/engines';
import {identifyProvider} from '../src/logic/models';
import {EngineModelPicker} from '../src/view/components/EngineModelPicker';
import {ProviderConnections,ProviderConnectionTest,connectionTestNotice} from '../src/view/settings/ProviderConnections';

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

test('MiniMax 兼容接口仅列出声明型号；自定义模型 ID 不因名字像 Claude 而获得兼容性',()=>{
  const minimax={...profile,name:'MiniMax',baseUrl:'https://api.minimax.io/v1',models:[{...profile.models[0],id:'MiniMax-M3'},{...profile.models[0],id:'legacy',name:'Legacy'}]};
  expect(providerSupportsEngine('claude-code',minimax,'MiniMax-M3')).toBe(true);
  expect(providerSupportsEngine('claude-code',minimax,'legacy')).toBe(false);
  expect(providerSupportsEngine('codex',minimax,'MiniMax-M3')).toBe(false);
  const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:true,profiles:[minimax]},initialEngine:'claude-code',onChange:()=>{}}));
  expect(html).toContain('MiniMax / Flash');expect(html).not.toContain('MiniMax / Legacy');
  expect(providerSupportsEngine('claude-code',{...profile,baseUrl:'https://custom.example/v1'},'claude-custom')).toBe(false);
});

test('模型设置预览和测试只选择接口，不要求了解引擎，渲染不会执行测试',()=>{
  let calls=0;
  const html=renderToStaticMarkup(createElement(ProviderConnections,{value:profile,onChange:()=>{calls++}}));
  expect(html).toContain('已识别 DeepSeek');expect(html).toContain('https://api.deepseek.com/anthropic');expect(html).toContain('自定义兼容接口');
  const custom={...profile,baseUrl:'https://custom.example/v1'};
  const tests=renderToStaticMarkup(createElement(ProviderConnectionTest,{profile:custom,busy:false,onTest:()=>{calls++}}));
  expect(tests).toMatch(/<option value="anthropic-messages" disabled/);expect(tests).toMatch(/<option value="openai-responses" disabled/);expect(tests).not.toContain('测试引擎');expect(calls).toBe(0);
  expect(connectionTestNotice('DeepSeek',{ok:true,model:'deepseek-flash',latencyMs:10,api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'})).toContain('Anthropic Messages，仅文本请求');
});
