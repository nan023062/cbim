import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';

const profile={name:'Shared models',api:'anthropic-messages',baseUrl:'http://127.0.0.1:9',auth:'none',defaultModel:'shared',models:[{id:'shared',name:'Shared',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};

test('一个 DeepSeek 供应商可在主会话保存三个引擎，启动选项沿原型号且不复制供应商',async()=>{
  const f=await fixture();try{
    const saved=await f.app.models.save({profile:{...profile,api:'openai-completions',baseUrl:'https://api.deepseek.com'}}),profileId=saved.selectedId!;
    const entry=await f.app.dispatch('add',{path:f.a}),identity={workspaceId:entry.id,instanceId:f.app.workspace(entry.id).instanceId};
    let settings=await f.app.dispatch('agent.mainSettings',identity);
    for(const engine of ['pi','claude-code','codex'] as const){
      settings=await f.app.dispatch('agent.configureMain',{...settings,selection:{engine,profileId,modelId:'shared'}});
      expect(await f.app.chatOptions(entry.id,{permission:'read'},[])).toMatchObject({engine,profileId,model:'shared'});
    }
    expect(await f.app.models.list()).toEqual(saved);expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0);
  }finally{await f.cleanup()}
});

test('对话与团队入口读写同一主 Agent 配置，新对话读取角色选型，重开保留且不启动模型',async()=>{
  const f=await fixture();try{
    const models=await f.app.models.save({profile}),profileId=models.selectedId!;
    const entry=await f.app.dispatch('add',{path:f.a}),identity={workspaceId:entry.id,instanceId:f.app.workspace(entry.id).instanceId};
    const conversation=await f.app.dispatch('agent.mainSettings',identity),team=await f.app.dispatch('agent.mainSettings',identity);
    expect(conversation).toEqual(team);expect(team).toMatchObject({agentId:'cbim:main',revision:0,selection:null});
    const selection={engine:'claude-code',profileId,modelId:'shared'};
    const saved=await f.app.dispatch('agent.configureMain',{...conversation,selection});
    expect(await f.app.dispatch('agent.mainSettings',identity)).toEqual(saved);
    const frozen=await f.app.chatOptions(entry.id,{permission:'read'},[]);
    expect(frozen).toMatchObject({engine:'claude-code',profileId,model:'shared'});
    await expect(f.app.dispatch('agent.configureMain',{...team,selection:{...selection,engine:'pi'}})).rejects.toMatchObject({code:'AGENT_SETTINGS_CONFLICT'});
    const next=await f.app.dispatch('agent.configureMain',{...saved,selection:{...selection,engine:'pi'}});
    expect(await f.app.chatOptions(entry.id,{permission:'read'},[])).toMatchObject({engine:'pi',profileId,model:'shared'});
    expect(frozen.engine).toBe('claude-code');
    const bytes=await fs.readFile(path.join(f.app.paths.project(entry.id),'main-agent.json'),'utf8');
    expect(JSON.parse(bytes)).toMatchObject({revision:next.revision,selection:next.selection});
    await f.app.open(entry.id,true);
    await expect(f.app.dispatch('agent.mainSettings',identity)).rejects.toThrow();
    const reopened=await f.app.dispatch('agent.mainSettings',{...identity,instanceId:f.app.workspace(entry.id).instanceId});
    expect(reopened.selection).toEqual(next.selection);expect(reopened.revision).toBe(next.revision);
    expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0);
    expect((await f.app.workspace(entry.id).dispatchStore.read()).runs??[]).toHaveLength(0);
  }finally{await f.cleanup()}
});

test('主 Agent 兼容性与工作区隔离：错误协议不覆盖配置，另一项目独立且损坏文件不静默重置',async()=>{
  const f=await fixture();try{
    const models=await f.app.models.save({profile}),profileId=models.selectedId!;
    const entry=await f.app.dispatch('add',{path:f.a}),other=await f.app.dispatch('add',{path:f.b});
    const identity={workspaceId:entry.id,instanceId:f.app.workspace(entry.id).instanceId};
    const initial=await f.app.dispatch('agent.mainSettings',identity);
    await expect(f.app.dispatch('agent.configureMain',{...initial,selection:{engine:'codex',profileId,modelId:'shared'}})).rejects.toMatchObject({code:'LLM_ENGINE_API'});
    expect(await f.app.dispatch('agent.mainSettings',identity)).toEqual(initial);
    const saved=await f.app.dispatch('agent.configureMain',{...initial,selection:{engine:'claude-code',profileId,modelId:'shared'}});
    expect(saved.revision).toBe(1);
    expect(await f.app.dispatch('agent.mainSettings',{workspaceId:other.id,instanceId:f.app.workspace(other.id).instanceId})).toMatchObject({selection:null,revision:0});
    await fs.writeFile(path.join(f.app.paths.project(entry.id),'main-agent.json'),'broken');
    await expect(f.app.dispatch('agent.mainSettings',identity)).rejects.toMatchObject({code:'AGENT_SETTINGS_READ'});
    await expect(f.app.dispatch('agent.configureMain',{...saved,selection:null})).rejects.toMatchObject({code:'AGENT_SETTINGS_READ'});
    expect(await fs.readFile(path.join(f.app.paths.project(entry.id),'main-agent.json'),'utf8')).toBe('broken');
  }finally{await f.cleanup()}
});
