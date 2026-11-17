// view/settings: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definition,type LlmDefinition,type LlmProfile} from '../../../logic/models/index';
import {connectionForEngine,providerSupportsEngine} from '../../../logic/engines/index';
import {identifyProvider} from '../../../logic/models/index';
import {EngineModelPicker} from '../../components/EngineModelPicker';
import {ProviderConnections,ProviderConnectionTest,connectionTestNotice} from '../ProviderConnections';

const profile:LlmProfile={id:'11111111-1111-4111-8111-111111111111',name:'DeepSeek',api:'openai-completions',baseUrl:'https://api.deepseek.com/v1',auth:'api-key',hasKey:true,defaultModel:'deepseek-flash',models:[{id:'deepseek-flash',name:'Flash',enabled:true,reasoning:true,contextWindow:1048576,maxTokens:4096}]};

test('模型设置预览和测试只选择接口，不要求了解引擎，渲染不会执行测试',()=>{
  let calls=0;
  const html=renderToStaticMarkup(createElement(ProviderConnections,{value:profile,onChange:()=>{calls++}}));
  expect(html).toContain('已识别 DeepSeek');expect(html).toContain('https://api.deepseek.com/anthropic');expect(html).toContain('自定义兼容接口');
  const custom={...profile,baseUrl:'https://custom.example/v1'};
  const tests=renderToStaticMarkup(createElement(ProviderConnectionTest,{profile:custom,busy:false,onTest:()=>{calls++}}));
  expect(tests).toMatch(/<option value="anthropic-messages" disabled/);expect(tests).toMatch(/<option value="openai-responses" disabled/);expect(tests).not.toContain('测试引擎');expect(calls).toBe(0);
  expect(connectionTestNotice('DeepSeek',{ok:true,model:'deepseek-flash',latencyMs:10,api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'})).toContain('Anthropic Messages，仅文本请求');
});
