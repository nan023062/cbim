import {test,expect} from 'vitest';
import {modelRoleChoices,engineSelectionAvailable} from '../../../../src/logic/engines';
import type {LlmSettings} from '../../../../src/logic/models';
const models:LlmSettings={secureStorage:true,profiles:[{id:'11111111-1111-4111-8111-111111111111',name:'Provider',api:'openai-completions',baseUrl:'https://custom.example/v1',auth:'none',hasKey:false,defaultModel:'shared',models:[{id:'shared',name:'生成',enabled:true,contextWindow:4096,maxTokens:1024,reasoning:false}],embedding:{api:'openai-embeddings',baseUrl:'https://custom.example/v1',models:[{id:'shared',name:'向量',enabled:true,inputTokens:8192,dimensions:3},{id:'disabled',name:'停用',enabled:false,inputTokens:8192,dimensions:3}]}}]};
test('同名生成/向量模型按角色分离，停用模型和未声明型号不进入选择',()=>{
  const vector={id:'embedding',label:'记忆向量',required:true,kind:'embedding' as const};
  expect(modelRoleChoices(vector,models)).toEqual([{profileId:models.profiles[0].id,modelId:'shared',label:'Provider / 向量'}]);
  expect(modelRoleChoices({...vector,modelIds:['different']},models)).toEqual([]);
  expect(modelRoleChoices({id:'reasoning',label:'生成',required:true,kind:'generation',connection:{supportedApis:['anthropic-messages'],fallbackApi:'anthropic-messages'}},models)).toEqual([]);
  expect(modelRoleChoices({id:'reasoning',label:'生成',required:true,kind:'generation',connection:{supportedApis:['openai-completions']}},models)[0].label).toBe('Provider / 生成');
});
test('旧 primary 选型保持可用，额外未声明角色及被禁用主模型不可发送',()=>{
  const value={engine:'pi' as const,profileId:models.profiles[0].id,modelId:'shared'};
  expect(engineSelectionAvailable(value,models)).toBe(true);
  expect(engineSelectionAvailable({...value,modelRoles:{version:2,roles:{unknown:{kind:'embedding',profileId:value.profileId,modelId:value.modelId}}}},models)).toBe(false);
  expect(engineSelectionAvailable(value,{...models,profiles:[{...models.profiles[0],models:[{...models.profiles[0].models[0],enabled:false}]}]})).toBe(false);
});
test('记忆引擎必填向量角色，纯生成配置不可发送；额外角色不能被主型号代替',()=>{
  const value={engine:'memory' as const,profileId:models.profiles[0].id,modelId:'shared'};
  expect(engineSelectionAvailable(value,models)).toBe(false);
  expect(engineSelectionAvailable({...value,modelRoles:{version:2,roles:{embedding:{kind:'embedding',profileId:value.profileId,modelId:'shared'}}}},models)).toBe(true);
  expect(engineSelectionAvailable({...value,modelRoles:{version:2,roles:{embedding:{kind:'generation',profileId:value.profileId,modelId:'shared'}}}},models)).toBe(false);
});
