import {expect,test} from 'vitest';
import {definition,connectionForEngine,identifyProvider,type LlmDefinition,type LlmProfile} from '../../../../src/logic/models';
const profile:LlmProfile={id:'11111111-1111-4111-8111-111111111111',name:'DeepSeek',api:'openai-completions',baseUrl:'https://api.deepseek.com/v1',auth:'api-key',hasKey:true,defaultModel:'deepseek-flash',models:[{id:'deepseek-flash',name:'Flash',enabled:true,reasoning:true,contextWindow:1048576,maxTokens:4096}]};

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

test('接口 schema 拒绝重复协议、未知型号与不安全地址，旧配置不补自动字段',()=>{
  const {id:_id,hasKey:_hasKey,...legacy}=profile;
  expect(definition.parse(legacy)).toEqual(legacy);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'openai-completions',baseUrl:'https://other.example/v1'}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'http://external.example'}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://other.example',modelIds:['unknown']}]}).success).toBe(false);
  expect(definition.safeParse({...legacy,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://other.example',modelIds:[]}]}).success).toBe(false);
});
