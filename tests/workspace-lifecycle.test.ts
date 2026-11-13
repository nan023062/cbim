import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {internalKnowledge} from './knowledge-tool-fixture';
import {Application} from '../src/backend/main/assembly/application';
import {AutoCollaboration} from '../src/backend/scheduler-engine/dispatch/auto-collaboration';
import {readJson,exists} from '../src/foundations/files';

it('登记工作区随应用启动，移除与退出释放实例，旧启动设置被清理',async()=>{
  const f=await fixture();let next:Application|undefined;try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b}),before=f.app.workspace(a.id).instanceId;
    const catalogFile=path.join(f.app.paths.userRoot,'workspaces.json');
    await fs.writeFile(catalogFile,JSON.stringify({...await f.app.catalog.read(),settings:{restore:false},lastRunning:[]}));
    await f.app.shutdown();next=new Application(f.app.paths,path.resolve('design'));await next.init();
    const wa=next.workspace(a.id),wb=next.workspace(b.id);
    expect(wa.state).toBe('running');expect(wb.state).toBe('running');expect(wa.instanceId).not.toBe(before);
    const migrated=await readJson(catalogFile);expect(migrated.entries.map((e:any)=>e.id).sort()).toEqual([a.id,b.id].sort());
    expect(migrated.settings).toBeUndefined();expect(migrated.lastRunning).toBeUndefined();
    for(const action of ['settings','forgetRecent','close','discovery','mcpLogs','writeAccess','restartMcp','workspace.restart'])await expect(next.dispatch(action,{id:a.id})).rejects.toMatchObject({code:'ACTION'});
    expect(next.workspace(a.id)).toBe(wa);
    await next.remove(a.id);expect(wa.state).toBe('closed');expect(wb.state).toBe('running');
    expect((await internalKnowledge(wb).call('cbim_workspace_identity')).workspaceId).toBe(b.id);
    await next.shutdown();expect(wb.state).toBe('closed');
    await expect(next.open(b.id)).rejects.toMatchObject({code:'SHUTTING_DOWN'});
  }finally{await next?.shutdown();await f.cleanup()}
});

it('协作等待恢复失败不会暴露半就绪服务，显式打开会关闭旧服务并重新初始化',async()=>{
  const f=await fixture(),original=AutoCollaboration.prototype.initialize;
  const initialize=vi.spyOn(AutoCollaboration.prototype,'initialize').mockImplementationOnce(async function(this:AutoCollaboration){await original.call(this);throw Error('等待队列保存失败')});
  try{
    const entry=await f.app.catalog.add(f.a);
    await expect(f.app.open(entry.id)).rejects.toThrow('等待队列保存失败');
    const failed=f.app.workspace(entry.id);expect(failed.state).toBe('failed');expect(failed.error).toContain('工作区服务初始化失败');
    for(const get of [()=>f.app.execution(entry.id),()=>f.app.memberExecution(entry.id),()=>f.app.memberDispatch(entry.id)])expect(get).toThrow('工作区当前状态');
    const retried=await f.app.open(entry.id);expect(retried.state).toBe('running');expect(retried.instanceId).not.toBe(failed.instanceId);expect(failed.state).toBe('closed');expect(initialize).toHaveBeenCalledTimes(2);
    expect(f.app.execution(entry.id)).toBeDefined();
  }finally{initialize.mockRestore();await f.cleanup()}
});

it('一个工作区丢失不阻止其他登记实例启动，也不创建丢失路径',async()=>{
  const f=await fixture();let next:Application|undefined;try{
    const a=await f.app.catalog.add(f.a),b=await f.app.catalog.add(f.b);
    const from=path.resolve(f.a),to=path.resolve(f.a+'-moved'),base=path.resolve(f.temp)+path.sep;
    expect(from.startsWith(base)&&to.startsWith(base)).toBe(true);
    await fs.rename(from,to);await f.app.shutdown();next=new Application(f.app.paths,path.resolve('design'));await next.init();
    expect(next.workspace(a.id).state).toBe('failed');expect(next.workspace(b.id).state).toBe('running');expect(await exists(f.a)).toBe(false);
  }finally{await next?.shutdown();await f.cleanup()}
});

it('工作区打开和重启只维护内部数据，不生成宿主配置、令牌或发现记录',async()=>{
  const f=await fixture();try{
    const absent=['AGENTS.md','CLAUDE.md','AGENTS.override.md','.mcp.json','.codex','.claude','.ignore','.rgignore','.cursorignore'];
    const a=await f.app.dispatch('add',{path:f.a}),before=f.app.workspace(a.id);
    for(const p of absent)expect(await exists(path.join(f.a,p)),p).toBe(false);
    await f.app.open(a.id,true);const current=f.app.workspace(a.id);
    expect(current.instanceId).not.toBe(before.instanceId);expect(before.state).toBe('closed');
    for(const p of absent)expect(await exists(path.join(f.a,p)),p).toBe(false);
    for(const p of ['discovery.json','credentials.json','logs/mcp-calls.ndjson'])expect(await exists(path.join(f.app.paths.project(a.id),p)),p).toBe(false);
    expect(Object.keys(current.view())).not.toContain('mcp');expect(Object.keys(current.view())).not.toContain('writable');
    const preserved={
      'CLAUDE.md':'# Existing Claude rules\nKeep exact bytes.\n','AGENTS.md':'# Existing agent rules\n',
      '.mcp.json':'{"mcpServers":{"external":{"command":"keep"}}}\n',
      '.codex/config.toml':'model = "custom"\n','.codex/hooks.json':'{"hooks":{}}\n',
      '.claude/settings.local.json':'{"permissions":{"deny":["Read(.env)"]}}\n',
      '.ignore':'own-ignore/\n','.rgignore':'own-search/\n','.cursorignore':'own-editor/\n'
    };
    for(const [p,text] of Object.entries(preserved)){const target=path.join(f.b,p);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text)}
    const b=await f.app.dispatch('add',{path:f.b});await f.app.open(b.id,true);
    for(const [p,text] of Object.entries(preserved))expect(await fs.readFile(path.join(f.b,p),'utf8'),p).toBe(text);
    expect(await exists(path.join(f.b,'AGENTS.override.md'))).toBe(false);
  }finally{await f.cleanup()}
});

it('内部重开合并重复请求，仅更换目标实例并保留知识',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b}),wa=f.app.workspace(a.id),wb=f.app.workspace(b.id);
    const before=await wa.read();
    const [one,two]=await Promise.all([f.app.open(a.id,true),f.app.open(a.id,true)]);
    expect(one.instanceId).toBe(two.instanceId);expect(one.instanceId).not.toBe(wa.instanceId);
    expect((await f.app.workspace(a.id).read()).revision).toBe(before.revision);expect(f.app.workspace(b.id)).toBe(wb);
    await expect(internalKnowledge(f.app.workspace(a.id)).call('cbim_knowledge_snapshot',{instanceId:wa.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  }finally{await f.cleanup()}
});

it('重启等待正在提交的事务完成，不丢失提交成果',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(a.id),snapshot=await ws.read();
    let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
    const validate=ws.rules.validate.bind(ws.rules);let once=true;ws.rules.validate=async(...args)=>{if(once){once=false;started();await gate}return validate(...args)};
    const commit=ws.commit(request(snapshot,[{path:'.cbim/README.md',text:'# durable restart'}]));await entered;
    const restarting=f.app.open(a.id,true);
    try{for(let i=0;i<100&&ws.state!=='closing';i++)await new Promise(r=>setTimeout(r,1));expect(ws.state).toBe('closing')}finally{release()}
    expect((await commit).state).toBe('committed');await restarting;
    expect((await f.app.workspace(a.id).read()).files.find(f=>f.path==='.cbim/README.md')?.text).toBe('# durable restart');
  }finally{await f.cleanup()}
});
