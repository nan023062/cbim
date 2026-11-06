import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {parse as parseToml} from 'smol-toml';
import {fixture,request} from './helpers';
import {Application} from '../src/backend/main/application';
import {readJson,exists} from '../src/backend/core/foundation/files';

it('所有登记服务随应用启动，关闭页面仍可调用，移除与退出释放服务',async()=>{
  const f=await fixture();let next:Application|undefined;
  try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});
    const before=f.app.workspace(a.id).instanceId;
    const catalogFile=path.join(f.app.paths.userRoot,'workspaces.json');
    await fs.writeFile(catalogFile,JSON.stringify({...await f.app.catalog.read(),settings:{restore:false},lastRunning:[]}));
    await f.app.shutdown();
    next=new Application(f.app.paths,path.resolve('design'));await next.init();
    const wa=next.workspace(a.id),wb=next.workspace(b.id);
    expect(wa.state).toBe('running');expect(wb.state).toBe('running');expect(wa.instanceId).not.toBe(before);
    const migrated=await readJson(catalogFile);
    expect(migrated.entries.map((e:any)=>e.id).sort()).toEqual([a.id,b.id].sort());
    expect(migrated.settings).toBeUndefined();expect(migrated.lastRunning).toBeUndefined();
    for(const action of ['settings','forgetRecent'])await expect(next.dispatch(action,{id:a.id})).rejects.toMatchObject({code:'ACTION'});
    await expect(next.dispatch('close',{id:a.id})).rejects.toMatchObject({code:'ACTION'});expect(next.workspace(a.id)).toBe(wa);
    const da=await readJson(next.paths.discovery(a.id)),db=await readJson(next.paths.discovery(b.id));
    expect(new URL(da.url).pathname).toBe(`/mcp/${a.id}/${wa.instanceId}`);expect(da.url).not.toBe(db.url);
    await next.remove(a.id);await expect(fetch(da.url)).rejects.toThrow();expect((await fetch(db.url)).status).toBe(401);
    await next.shutdown();await expect(fetch(db.url)).rejects.toThrow();expect(await exists(next.paths.discovery(b.id))).toBe(false);
    await expect(next.open(b.id)).rejects.toMatchObject({code:'SHUTTING_DOWN'});
  }finally{await next?.shutdown();await f.cleanup()}
});

it('一个工作区丢失不阻止其他登记服务启动，也不创建丢失路径',async()=>{
  const f=await fixture();let next:Application|undefined;
  try{
    const a=await f.app.catalog.add(f.a),b=await f.app.catalog.add(f.b);
    await fs.rename(f.a,f.a+'-moved');await f.app.shutdown();
    next=new Application(f.app.paths,path.resolve('design'));await next.init();
    expect(next.workspace(a.id).state).toBe('failed');expect(next.workspace(b.id).state).toBe('running');expect(await exists(f.a)).toBe(false);
  }finally{await next?.shutdown();await f.cleanup()}
});

it('自动安装两种宿主配置，保留手工设置，补回缺失配置且不泄露令牌',async()=>{
  const f=await fixture();try{
    await fs.mkdir(path.join(f.a,'.codex'));const codex=path.join(f.a,'.codex/config.toml'),claude=path.join(f.a,'.mcp.json');
    await fs.writeFile(codex,'# keep comment\nmodel = "custom"\n[mcp_servers.other]\ncommand = "other"\n');
    await fs.writeFile(claude,'{ "mcpServers": { "other": { "command": "other" } } }');
    const entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id),name='cbim-'+entry.id;
    expect(w.hostConfigWarnings).toEqual([]);
    const first=await fs.readFile(codex,'utf8');expect(first).toContain('# keep comment');expect(parseToml(first).model).toBe('custom');
    expect((await readJson(claude)).mcpServers.other.command).toBe('other');
    const config=(await readJson(claude)).mcpServers[name];expect(config.args).toContain(entry.id);
    expect(JSON.stringify(config)).not.toContain(w.writeToken);expect(JSON.stringify(config)).not.toContain(w.readToken);
    await f.app.open(entry.id);expect(await fs.readFile(codex,'utf8')).toBe(first);expect(f.app.workspace(entry.id).instanceId).toBe(w.instanceId);
    await fs.unlink(claude);await f.app.open(entry.id);expect((await readJson(claude)).mcpServers[name]).toEqual(config);
    await fs.writeFile(codex,'invalid = [');await f.app.open(entry.id);expect(await fs.readFile(codex,'utf8')).toBe('invalid = [');expect(w.hostConfigWarnings[0]).toContain('codex');expect(w.state).toBe('running');
  }finally{await f.cleanup()}
});

it('真实 stdio 宿主发现工具、写权限和实例校验，CBIM 重启后连接新实例',async()=>{
  const f=await fixture();const client=new Client({name:'test-host',version:'1'});let next:Application|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id);
    const config=(await readJson(path.join(f.a,'.mcp.json'))).mcpServers['cbim-'+entry.id];
    const transport=new StdioClientTransport({...config,cwd:f.a,env:{...process.env,...config.env},stderr:'pipe'});let stderr='';transport.stderr?.on('data',data=>{stderr+=data});
    try{await client.connect(transport)}catch(e){throw Error(String(e)+'\n'+stderr)}
    expect((await client.listTools()).tools.some(t=>t.name==='cbim_knowledge_snapshot')).toBe(true);
    const identity=JSON.parse(((await client.callTool({name:'cbim_workspace_identity',arguments:{}})).content as any)[0].text);
    expect(identity.workspaceId).toBe(entry.id);expect(identity.instanceId).toBe(w.instanceId);
    const change=request(await w.read(),[{path:'.cbim/README.md',text:'# host write'}]);
    expect((await client.callTool({name:'cbim_knowledge_commit',arguments:change})).isError).toBe(true);
    w.writable=true;expect((await client.callTool({name:'cbim_knowledge_commit',arguments:change})).isError).not.toBe(true);
    await expect(f.app.dispatch('close',{id:entry.id})).rejects.toMatchObject({code:'ACTION'});expect((await client.callTool({name:'cbim_workspace_identity',arguments:{}})).isError).not.toBe(true);
    await f.app.shutdown();expect((await client.callTool({name:'cbim_workspace_identity',arguments:{}})).isError).toBe(true);
    next=new Application(f.app.paths,path.resolve('design'));await next.init();
    const live=JSON.parse(((await client.callTool({name:'cbim_workspace_identity',arguments:{}})).content as any)[0].text);
    expect(live.instanceId).not.toBe(identity.instanceId);expect(live.workspaceId).toBe(entry.id);
    expect((await client.callTool({name:'cbim_knowledge_snapshot',arguments:{workspaceId:entry.id,instanceId:identity.instanceId}})).isError).toBe(true);
  }finally{await client.close();await next?.shutdown();await f.cleanup()}
});

it('同名手工配置和指向外部的配置目录保留，失败不阻止后台 MCP',async()=>{
  const f=await fixture();try{
    const entry=await f.app.catalog.add(f.a),name='cbim-'+entry.id;
    const original=JSON.stringify({mcpServers:{[name]:{type:'http',url:'https://example.invalid/mcp'}}});
    await fs.writeFile(path.join(f.a,'.mcp.json'),original);
    await fs.symlink(f.b,path.join(f.a,'.codex'),'junction');
    const ws=await f.app.open(entry.id);expect(ws.state).toBe('running');expect(ws.hostConfigWarnings).toHaveLength(4);
    expect(ws.hostConfigWarnings.some(w=>w.startsWith('.codex/hooks.json:'))).toBe(true);
    expect(await fs.readFile(path.join(f.a,'.mcp.json'),'utf8')).toBe(original);expect(await fs.readdir(f.b)).toEqual([]);
    await fs.unlink(path.join(f.a,'.codex'));
  }finally{await f.cleanup()}
});
