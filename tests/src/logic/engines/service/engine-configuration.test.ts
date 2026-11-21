// logic/engines/service: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../../../../../src/logic/models/service/index';
import {EngineModelProfiles,type LockedEngineModelConfiguration} from '../../../../../src/logic/engines/service/index';
import {definition,type LlmDefinition,type LlmProfile} from '../../../../../src/logic/models/index';
import {engineSupportsApi,loopEngineSchema} from '../../../../../src/logic/engines/index';
import {workspaceMemberModelHash} from '../../../../../src/logic/team/rules/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../../../../../src/logic/team/rules/workspace-member';
import {objectOperation} from '../../../../../src/logic/knowledge/rules/object-crud';
import {queuedMessageSchema} from '../../../../../src/logic/tasks/rules/queue';

const base:LlmDefinition={name:'Shared provider',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));const profiles=new LlmProfiles(path.join(root,'models.json'));return {profiles,models:new EngineModelProfiles(profiles),filename:path.join(root,'models.json'),cleanup:async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}}}

test('引擎选型沿用模型配置短锁，捕获后修改不能漂移；回调外即使已有缓存也不能解密',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
  try{
    const saved=await f.profiles.Save({profile:base}),id=saved.selectedId!;
    let escaped!:LockedEngineModelConfiguration,updated=false;
    const selected=f.models.WithRuntimeConfiguration({profileId:id,modelId:'test',engine:'claude-code'},async locked=>{
      escaped=locked;entered();await gate;
      expect(updated).toBe(false);expect(locked.profile).toMatchObject({name:base.name,engine:'claude-code'});
      const first=locked.Resolve();expect(locked.Resolve()).toBe(first);return first;
    });
    await ready;
    const update=f.profiles.Save({id,profile:{...base,name:'New provider name'}}).then(()=>{updated=true});
    await new Promise<void>(resolve=>setImmediate(resolve));expect(updated).toBe(false);release();
    const resolved=await selected;await update;
    expect(resolved.profile.name).toBe(base.name);expect(updated).toBe(true);
    expect(()=>escaped.Resolve()).toThrow(/已结束/);
    expect((await f.models.Configuration(id,'test','claude-code')).name).toBe('New provider name');
  }finally{release?.();await f.cleanup()}
});

test('接口不兼容和回调中止都不会自动重试，原模型队列仍可继续使用',async()=>{
  const f=await fixture();try{
    const saved=await f.profiles.Save({profile:base}),ref={profileId:saved.selectedId!,modelId:'test'};let calls=0;
    await expect(f.models.WithRuntimeConfiguration({...ref,engine:'codex'},async()=>{calls++;})).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    expect(calls).toBe(0);
    const stopped=Object.assign(Error('stopped'),{code:'COLLABORATION_STOPPED'});
    await expect(f.models.WithRuntimeConfiguration({...ref,engine:'claude-code'},async()=>{calls++;throw stopped})).rejects.toBe(stopped);
    expect(calls).toBe(1);
    await f.profiles.Save({id:ref.profileId,profile:{...base,name:'Still usable'}});
    expect((await f.models.Configuration(ref.profileId,ref.modelId)).name).toBe('Still usable');
  }finally{await f.cleanup()}
});

test('同一供应商模型可分别解析 Pi 和 Claude；旧 Pi 快照不补字段，选择引擎不改模型文件',async()=>{
  const f=await fixture();try{
    const saved=await f.profiles.Save({profile:base}),id=saved.selectedId!,bytes=await fs.readFile(f.filename,'utf8');
    const legacy=await f.models.Configuration(id,'test'),pi=await f.models.Configuration(id,'test','pi'),claude=await f.models.Configuration(id,'test','claude-code');
    expect(Object.hasOwn(legacy,'engine')).toBe(false);expect(workspaceMemberModelSnapshotSchema.parse(legacy)).toEqual(legacy);
    expect(pi).toEqual({...legacy,engine:'pi'});expect(claude).toEqual({...legacy,engine:'claude-code'});
    expect(new Set([legacy,pi,claude].map(workspaceMemberModelHash)).size).toBe(3);
    expect(await fs.readFile(f.filename,'utf8')).toBe(bytes);
    expect((await f.models.Resolve(id,'test','claude-code')).profile).toEqual(claude);
    await expect(f.models.Resolve(id,'test','codex')).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    await f.models.WithConfigurations([{profileId:id,modelId:'test',engine:'pi'},{profileId:id,modelId:'test',engine:'claude-code'}],async profiles=>{expect(profiles).toEqual([pi,claude])});
    await f.models.WithRuntimeConfiguration({profileId:id,modelId:'test',engine:'claude-code'},async locked=>{expect(locked.profile).toEqual(claude);expect(locked.Resolve().profile).toEqual(claude)});
  }finally{await f.cleanup()}
});

test('旧供应商 engine 可读但不决定新执行；显式读取历史原生选型保持快照字节',async()=>{
  const f=await fixture();try{
    const saved=await f.profiles.Save({profile:{...base,engine:'claude-code'}}),id=saved.selectedId!;
    const old=await f.models.Configuration(id,'test','claude-code');
    await f.profiles.Save({id,profile:base});
    expect(await f.models.Configuration(id,'test','claude-code')).toEqual(old);
    expect((await f.models.Configuration(id,'test','pi')).engine).toBe('pi');
    expect((await f.models.Configuration(id,'test')).engine).toBeUndefined();
    expect(definition.safeParse({...base,engine:'codex'}).success).toBe(true);
    expect(workspaceMemberModelSnapshotSchema.safeParse({...old,api:'openai-responses'}).success).toBe(false);
  }finally{await f.cleanup()}
});

test('同一 Responses 模型可供 Pi 与 Codex 使用；禁用模型不进入任何新执行',async()=>{
  const f=await fixture();try{
    const saved=await f.profiles.Save({profile:{...base,api:'openai-responses'}}),id=saved.selectedId!;
    for(const engine of ['pi','codex'] as const){const snapshot=await f.models.Configuration(id,'test',engine);expect(snapshot.engine).toBe(engine);expect(workspaceMemberModelSnapshotSchema.parse(snapshot)).toEqual(snapshot)}
    await expect(f.models.Configuration(id,'test','claude-code')).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    await f.profiles.Save({id,profile:{...base,api:'openai-responses',defaultModel:'other',models:[{...base.models[0],enabled:false},{...base.models[0],id:'other'}]}});
    await expect(f.models.Configuration(id,'test','codex')).rejects.toMatchObject({code:'LLM_MODEL'});
  }finally{await f.cleanup()}
});


test('V2 角色块跨 Agent 和队列保留，公开预览修改不能污染执行快照；未声明角色在回调前拒绝',async()=>{
  const f=await fixture();try{
    const saved=await f.profiles.Save({profile:base}),profileId=saved.selectedId!,modelRoles={version:2 as const,roles:{}};
    const reference={engine:'pi' as const,profileId,modelId:'test',modelRoles};
    const legacy=await f.models.Configuration(profileId,'test','pi'),v2=await f.models.Configuration(profileId,'test','pi',modelRoles);
    expect(legacy).not.toHaveProperty('modelRoles');expect(v2).toEqual({...legacy,modelRoles});
    expect(workspaceMemberModelSnapshotSchema.parse(v2)).toEqual(v2);
    expect(workspaceMemberModelHash(v2)).not.toBe(workspaceMemberModelHash(legacy));
    expect(objectOperation.parse({kind:'agent',action:'update',id:'.cbim/team/test',data:{runtime:reference}}).data).toEqual({runtime:reference});
    expect(queuedMessageSchema.parse({id:randomUUID(),taskId:randomUUID(),message:'test',status:'pending',options:{engine:'pi',modelRoles,provider:'cbim-'+profileId,profileId,model:'test'}}).options.modelRoles).toEqual(modelRoles);
    await f.models.WithRuntimeConfiguration(reference,async locked=>{locked.profile.name='tampered';expect(locked.Resolve().profile).toEqual(v2);expect(locked.Resolve().modelRoles).toEqual({})});
    let called=false;
    await expect(f.models.WithRuntimeConfiguration({...reference,modelRoles:{version:2,roles:{embedding:{kind:'embedding',profileId,modelId:'vec'}}}},async()=>{called=true})).rejects.toMatchObject({code:'LLM_MODEL_ROLE'});
    expect(called).toBe(false);
  }finally{await f.cleanup()}
});
