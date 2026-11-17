// view/components: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definition,type LlmDefinition,type LlmProfile} from '../../../logic/models/index';
import {connectionForEngine,providerSupportsEngine} from '../../../logic/engines/index';
import {identifyProvider} from '../../../logic/models/index';
import {EngineModelPicker} from '../EngineModelPicker';
import {ProviderConnections,ProviderConnectionTest,connectionTestNotice} from '../../settings/ProviderConnections';

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
