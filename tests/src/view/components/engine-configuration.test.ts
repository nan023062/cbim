// view/components: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../../../../src/logic/models/service/index';
import {EngineModelProfiles,type LockedEngineModelConfiguration} from '../../../../src/logic/engines/service/index';
import {definition,type LlmDefinition,type LlmProfile} from '../../../../src/logic/models/index';
import {engineSupportsApi,loopEngineSchema} from '../../../../src/logic/engines/index';
import {workspaceMemberModelHash} from '../../../../src/logic/team/rules/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../../../../src/logic/team/rules/workspace-member';
import {objectOperation} from '../../../../src/logic/knowledge/rules/object-crud';
import {queuedMessageSchema} from '../../../../src/logic/tasks/rules/queue';
import {EngineModelPicker} from '../../../../src/view/components/EngineModelPicker';

const base:LlmDefinition={name:'Shared provider',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));const profiles=new LlmProfiles(path.join(root,'models.json'));return {profiles,models:new EngineModelProfiles(profiles),filename:path.join(root,'models.json'),cleanup:async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}}}

test('空目录和只有旧模型的目录都可选择官方引擎；模型按协议及启用状态筛选',()=>{
  const shared:LlmProfile={...base,id:randomUUID(),hasKey:false};
  const chat:LlmProfile={...base,name:'Chat only',id:randomUUID(),hasKey:false,api:'openai-completions'};
  const disabled:LlmProfile={...base,name:'Disabled',id:randomUUID(),hasKey:false,models:base.models.map(m=>({...m,enabled:false}))};
  for(const profiles of [[],[shared,chat,disabled]]){
    const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles},initialEngine:'claude-code',onChange:()=>{}}));
    expect(html).toMatch(/<option value="pi"[^>]*>Pi<\/option>/);expect(html).toMatch(/<option value="claude-code"[^>]*>Claude Code<\/option>/);expect(html).toMatch(/<option value="codex"[^>]*>Codex<\/option>/);
    expect(html).toMatch(/<option value="memory"[^>]*>记忆引擎<\/option>/);
    expect(html).not.toMatch(/<option value="(?:pi|claude-code|codex|memory)"[^>]*disabled/);
    expect(html).not.toContain('Chat only /');expect(html).not.toContain('Disabled /');
    if(profiles.length)expect(html).toContain('Shared provider / Test model');else expect(html).toContain('当前没有与');
  }
  const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles:[shared]},value:{engine:'pi',profileId:shared.id,modelId:'test'},onChange:()=>{}}));
  expect(html).toContain('Shared provider / Test model');
  expect(renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles:[shared]},value:{engine:'claude-code',profileId:randomUUID(),modelId:'test'},onChange:()=>{}}))).toContain('原模型已不可用');
});

test('Claude 模型选择诊断区分空目录、协议不匹配和已禁用；非 Claude 型号原样可选',async()=>{
  const render=(profiles:LlmProfile[])=>renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles},initialEngine:'claude-code',onChange:()=>{}}));
  const compatible:LlmProfile={...base,id:randomUUID(),hasKey:false};
  expect(render([])).toContain('尚未配置供应商');
  expect(render([{...compatible,api:'openai-completions'}])).toContain('仅有 OpenAI Chat/Responses 地址时不能直接切换协议');
  expect(render([{...compatible,models:base.models.map(m=>({...m,enabled:false}))}])).toContain('添加或启用模型');
  const f=await fixture();try{
    const modelId='vendor/qwen-custom-2026',saved=await f.profiles.Save({profile:{...base,defaultModel:modelId,models:[{...base.models[0],id:modelId,name:modelId}]}});
    expect(render(saved.profiles)).toContain(modelId);
    expect((await f.models.Resolve(saved.selectedId,modelId,'claude-code')).profile.model).toBe(modelId);
  }finally{await f.cleanup()}
});
