import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../src/logic/models/service';
import {definition,type LlmDefinition,type LlmProfile} from '../src/logic/models';
import {engineSupportsApi,loopEngineSchema} from '../src/logic/models';
import {workspaceMemberModelHash} from '../src/backend/core/team/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../src/backend/core/team/workspace-member';
import {objectOperation} from '../src/backend/core/knowledge/object-crud';
import {queuedMessageSchema} from '../src/backend/core/tasks/queue';
import {EngineModelPicker} from '../src/frontend/components/EngineModelPicker';

const base:LlmDefinition={name:'Shared provider',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));return {models:new LlmProfiles(path.join(root,'models.json')),filename:path.join(root,'models.json'),cleanup:async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}}}

test('同一供应商模型可分别解析 Pi 和 Claude；旧 Pi 快照不补字段，选择引擎不改模型文件',async()=>{
  const f=await fixture();try{
    const saved=await f.models.save({profile:base}),id=saved.selectedId!,bytes=await fs.readFile(f.filename,'utf8');
    const legacy=await f.models.configuration(id,'test'),pi=await f.models.configuration(id,'test','pi'),claude=await f.models.configuration(id,'test','claude-code');
    expect(Object.hasOwn(legacy,'engine')).toBe(false);expect(workspaceMemberModelSnapshotSchema.parse(legacy)).toEqual(legacy);
    expect(pi).toEqual({...legacy,engine:'pi'});expect(claude).toEqual({...legacy,engine:'claude-code'});
    expect(new Set([legacy,pi,claude].map(workspaceMemberModelHash)).size).toBe(3);
    expect(await fs.readFile(f.filename,'utf8')).toBe(bytes);
    expect((await f.models.resolve(id,'test','claude-code')).profile).toEqual(claude);
    await expect(f.models.resolve(id,'test','codex')).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    await f.models.withConfigurations([{profileId:id,modelId:'test',engine:'pi'},{profileId:id,modelId:'test',engine:'claude-code'}],async profiles=>{expect(profiles).toEqual([pi,claude])});
    await f.models.withRuntimeConfiguration({profileId:id,modelId:'test',engine:'claude-code'},async locked=>{expect(locked.profile).toEqual(claude);expect(locked.resolve().profile).toEqual(claude)});
  }finally{await f.cleanup()}
});

test('旧供应商 engine 可读但不决定新执行；显式读取历史原生选型保持快照字节',async()=>{
  const f=await fixture();try{
    const saved=await f.models.save({profile:{...base,engine:'claude-code'}}),id=saved.selectedId!;
    const old=await f.models.configuration(id,'test','claude-code');
    await f.models.save({id,profile:base});
    expect(await f.models.configuration(id,'test','claude-code')).toEqual(old);
    expect((await f.models.configuration(id,'test','pi')).engine).toBe('pi');
    expect((await f.models.configuration(id,'test')).engine).toBeUndefined();
    expect(definition.safeParse({...base,engine:'codex'}).success).toBe(true);
    expect(workspaceMemberModelSnapshotSchema.safeParse({...old,api:'openai-responses'}).success).toBe(false);
  }finally{await f.cleanup()}
});

test.each([
  ['openai-completions',['pi']],['anthropic-messages',['pi','claude-code']],['openai-responses',['pi','codex']],['unknown',[]],
])('协议 %s 只映射到真实支持的引擎', (api,expected)=>{
  expect(loopEngineSchema.options.filter(engine=>engineSupportsApi(engine,api as string))).toEqual(expected);
});

test('空目录和只有旧模型的目录都可选择三个内置引擎；模型按协议及启用状态筛选',()=>{
  const shared:LlmProfile={...base,id:randomUUID(),hasKey:false};
  const chat:LlmProfile={...base,name:'Chat only',id:randomUUID(),hasKey:false,api:'openai-completions'};
  const disabled:LlmProfile={...base,name:'Disabled',id:randomUUID(),hasKey:false,models:base.models.map(m=>({...m,enabled:false}))};
  for(const profiles of [[],[shared,chat,disabled]]){
    const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles},initialEngine:'claude-code',onChange:()=>{}}));
    expect(html).toMatch(/<option value="pi"[^>]*>Pi<\/option>/);expect(html).toMatch(/<option value="claude-code"[^>]*>Claude Code<\/option>/);expect(html).toMatch(/<option value="codex"[^>]*>Codex<\/option>/);
    expect(html).not.toMatch(/<option value="(?:pi|claude-code|codex)"[^>]*disabled/);
    expect(html).not.toContain('Chat only /');expect(html).not.toContain('Disabled /');
    if(profiles.length)expect(html).toContain('Shared provider / Test model');else expect(html).toContain('当前没有与');
  }
  const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles:[shared]},value:{engine:'pi',profileId:shared.id,modelId:'test'},onChange:()=>{}}));
  expect(html).toContain('Shared provider / Test model');
  expect(renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles:[shared]},value:{engine:'claude-code',profileId:randomUUID(),modelId:'test'},onChange:()=>{}}))).toContain('原模型已不可用');
});

test.each(['claude-code','codex'] as const)('Agent 与已排队消息各自冻结 %s 引擎，不从供应商推断',engine=>{
  const runtime={engine,profileId:randomUUID(),modelId:'test'};
  expect(objectOperation.parse({kind:'agent',action:'update',id:'.cbim/team/test',data:{runtime}}).data).toEqual({runtime});
  expect(objectOperation.safeParse({kind:'module',action:'update',id:'.cbim/workspace/test',data:{runtime}}).success).toBe(false);
  expect(queuedMessageSchema.parse({id:randomUUID(),taskId:randomUUID(),message:'test',status:'pending',options:{engine,provider:'cbim-'+runtime.profileId,profileId:runtime.profileId,model:'test'}}).options.engine).toBe(engine);
});

test('Claude 模型选择诊断区分空目录、协议不匹配和已禁用；非 Claude 型号原样可选',async()=>{
  const render=(profiles:LlmProfile[])=>renderToStaticMarkup(createElement(EngineModelPicker,{models:{secureStorage:false,profiles},initialEngine:'claude-code',onChange:()=>{}}));
  const compatible:LlmProfile={...base,id:randomUUID(),hasKey:false};
  expect(render([])).toContain('尚未配置供应商');
  expect(render([{...compatible,api:'openai-completions'}])).toContain('仅有 OpenAI Chat/Responses 地址时不能直接切换协议');
  expect(render([{...compatible,models:base.models.map(m=>({...m,enabled:false}))}])).toContain('添加或启用模型');
  const f=await fixture();try{
    const modelId='vendor/qwen-custom-2026',saved=await f.models.save({profile:{...base,defaultModel:modelId,models:[{...base.models[0],id:modelId,name:modelId}]}});
    expect(render(saved.profiles)).toContain(modelId);
    expect((await f.models.resolve(saved.selectedId,modelId,'claude-code')).profile.model).toBe(modelId);
  }finally{await f.cleanup()}
});

test('同一 Responses 模型可供 Pi 与 Codex 使用；禁用模型不进入任何新执行',async()=>{
  const f=await fixture();try{
    const saved=await f.models.save({profile:{...base,api:'openai-responses'}}),id=saved.selectedId!;
    for(const engine of ['pi','codex'] as const){const snapshot=await f.models.configuration(id,'test',engine);expect(snapshot.engine).toBe(engine);expect(workspaceMemberModelSnapshotSchema.parse(snapshot)).toEqual(snapshot)}
    await expect(f.models.configuration(id,'test','claude-code')).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    await f.models.save({id,profile:{...base,api:'openai-responses',defaultModel:'other',models:[{...base.models[0],enabled:false},{...base.models[0],id:'other'}]}});
    await expect(f.models.configuration(id,'test','codex')).rejects.toMatchObject({code:'LLM_MODEL'});
  }finally{await f.cleanup()}
});
