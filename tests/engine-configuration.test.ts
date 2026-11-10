import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../src/backend/main/persistence/settings/llm-profiles';
import {definition,type LlmDefinition,type LlmProfile} from '../src/backend/core/brain/llm/config';
import {configuredEngines} from '../src/backend/core/brain/llm/engine';
import {workspaceMemberModelHash} from '../src/backend/core/team/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../src/backend/core/team/workspace-member';
import {objectOperation} from '../src/backend/core/knowledge/object-crud';
import {queuedMessageSchema} from '../src/backend/core/tasks/queue';
import {EngineModelPicker} from '../src/frontend/components/EngineModelPicker';

const base:LlmDefinition={name:'Test Pi',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
test('legacy configuration keeps its snapshot bytes; explicit engine survives save, reload and member hashing',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));
  try{
    const filename=path.join(root,'models.json'),models=new LlmProfiles(filename),saved=await models.save({profile:base}),id=saved.selectedId!;
    const old=await models.configuration(id,'test');expect(Object.hasOwn(old,'engine')).toBe(false);expect(workspaceMemberModelSnapshotSchema.parse(old)).toEqual(old);
    await models.save({id,profile:{...base,engine:'claude-code'}});
    const current=await new LlmProfiles(filename).configuration(id,'test');expect(current).toEqual({...old,engine:'claude-code'});expect(workspaceMemberModelHash(current)).not.toBe(workspaceMemberModelHash(old));expect(workspaceMemberModelSnapshotSchema.parse(current)).toEqual(current);
    expect(workspaceMemberModelSnapshotSchema.safeParse({...current,api:'openai-responses'}).success).toBe(false);
  }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}
});
test('Claude configurations require the supported API; engine choices only use enabled user models',()=>{
  expect(definition.safeParse({...base,engine:'claude-code',api:'openai-responses'}).success).toBe(false);
  expect(configuredEngines([{...base},{...base,engine:'claude-code'},{...base,engine:'pi',models:base.models.map(m=>({...m,enabled:false}))}])).toEqual(['pi','claude-code']);
  expect(configuredEngines([])).toEqual([]);
});
test('Agent picker filters model options by engine and keeps unavailable selections visible',()=>{
  const pi:LlmProfile={...base,id:randomUUID(),hasKey:false},claude:LlmProfile={...base,name:'Test Claude',engine:'claude-code',id:randomUUID(),hasKey:false};
  const value={engine:'claude-code' as const,profileId:claude.id,modelId:'test'},props={models:{secureStorage:false,profiles:[pi,claude]},value,onChange:()=>{}};
  const html=renderToStaticMarkup(createElement(EngineModelPicker,props));expect(html).toContain('Test Claude / Test model');expect(html).not.toContain('Test Pi / Test model');expect(html).toContain('Claude Code');
  expect(renderToStaticMarkup(createElement(EngineModelPicker,{...props,value:{...value,profileId:randomUUID()}}))).toContain('原模型已不可用');
});
test('Agent runtime selection belongs to Agent data and queued messages preserve the frozen engine',()=>{
  const runtime={engine:'claude-code',profileId:randomUUID(),modelId:'test'};
  expect(objectOperation.parse({kind:'agent',action:'update',id:'.cbim/team/test',data:{runtime}}).data).toEqual({runtime});
  expect(objectOperation.safeParse({kind:'module',action:'update',id:'.cbim/workspace/test',data:{runtime}}).success).toBe(false);
  expect(queuedMessageSchema.parse({id:randomUUID(),taskId:randomUUID(),message:'test',status:'pending',options:{engine:'claude-code',provider:'cbim-'+runtime.profileId,profileId:runtime.profileId,model:'test'}}).options.engine).toBe('claude-code');
});

test('Codex 配置只接受 Responses；保存、岗位快照和用户菜单共用明确引擎',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-codex-config-'));
  try{
    expect(definition.safeParse({...base,engine:'codex'}).success).toBe(false);
    const models=new LlmProfiles(path.join(root,'models.json')),saved=await models.save({profile:{...base,engine:'codex',api:'openai-responses'}}),id=saved.selectedId!,snapshot=await models.configuration(id,'test');
    expect(snapshot.engine).toBe('codex');expect(workspaceMemberModelSnapshotSchema.parse(snapshot)).toEqual(snapshot);expect(workspaceMemberModelSnapshotSchema.safeParse({...snapshot,api:'openai-completions'}).success).toBe(false);
    expect(configuredEngines([...saved.profiles,{...base,engine:'pi'}])).toEqual(['codex','pi']);
    const html=renderToStaticMarkup(createElement(EngineModelPicker,{models:saved,value:{engine:'codex',profileId:id,modelId:'test'},onChange:()=>{}}));expect(html).toContain('Codex');expect(html).toContain('Test Pi / Test model');
    const runtime={engine:'codex',profileId:id,modelId:'test'};expect(objectOperation.parse({kind:'agent',action:'update',id:'.cbim/team/test',data:{runtime}}).data).toEqual({runtime});
    expect(queuedMessageSchema.parse({id:randomUUID(),taskId:randomUUID(),message:'test',status:'pending',options:{engine:'codex',provider:'cbim-'+id,profileId:id,model:'test'}}).options.engine).toBe('codex');
  }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-codex-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}
});
