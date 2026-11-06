import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {readJson} from '../src/backend/core/foundation/files';
import {McpCallLogs} from '../src/backend/main/integrations/mcp/mcp-log';

it('记录成功、参数与身份错误和 HTTP 失败，不记录正文令牌；日志隔离并跨重启保留',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b}),wa=f.app.workspace(a.id),wb=f.app.workspace(b.id),d=await readJson(f.app.paths.discovery(a.id));
    expect(wa.calls.view().entries).toEqual([]);
    const call=async(method:string,params:any)=>{const res=await fetch(d.url,{method:'POST',headers:{Authorization:'Bearer '+wa.writeToken,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params})});return res.json()};
    await call('tools/call',{name:'cbim_knowledge_search',arguments:{workspaceId:a.id,instanceId:wa.instanceId,query:'secret-query-must-not-be-logged'}});
    await call('tools/call',{name:'cbim_knowledge_snapshot',arguments:{workspaceId:a.id,instanceId:'stale'}});
    await call('tools/call',{name:'cbim_knowledge_snapshot',arguments:{}});
    await call('unknown_method',{});
    await fetch(d.url);
    await wa.calls.flush();
    const entries=wa.calls.view().entries;expect(entries).toHaveLength(5);expect(entries.some(x=>x.tool==='cbim_knowledge_search'&&x.result==='ok')).toBe(true);
    expect(entries.some(x=>x.code==='STALE_INSTANCE')).toBe(true);expect(entries.some(x=>x.tool==='cbim_knowledge_snapshot'&&x.code==='TOOL_ERROR'&&x.message?.includes('workspaceId'))).toBe(true);
    expect(entries.some(x=>x.method==='unknown_method'&&x.result==='error')).toBe(true);expect(entries.some(x=>x.status===401)).toBe(true);
    expect(wa.mcp.view().errors).toBe(4);expect(wb.calls.view().entries).toEqual([]);
    const stored=await fs.readFile(wa.calls.file,'utf8');for(const secret of ['secret-query-must-not-be-logged',wa.writeToken,wa.readToken])expect(stored).not.toContain(secret);
    await f.app.dispatch('restartMcp',{id:a.id});expect(f.app.workspace(a.id).calls.view().entries).toHaveLength(5);expect(f.app.workspace(a.id).calls.view().entries.every(x=>x.instanceId===wa.instanceId)).toBe(true);
  }finally{await f.cleanup()}
});

it('调用日志轮转且只返回最近 200 条，写入失败可见并不抛出到服务请求',async()=>{
  const f=await fixture();try{
    const file=path.join(f.user,'calls.ndjson'),logs=new McpCallLogs(file,'test',3000);await logs.init();
    for(let i=0;i<205;i++){logs.add({id:String(i),time:new Date().toISOString(),workspaceId:'test',instanceId:'test',httpMethod:'POST',method:'tools/list',status:200,result:'ok',durationMs:1,receivedBytes:10,sentBytes:20});await logs.flush()}
    expect(logs.view().entries).toHaveLength(200);expect(logs.view().entries[0].id).toBe('204');expect((await fs.stat(file+'.1')).size).toBeLessThan(4000);
    const restored=new McpCallLogs(file,'test',3000);await restored.init();expect(restored.view().entries[0].id).toBe('204');
    await fs.mkdir(path.join(f.user,'blocked'));const blocked=new McpCallLogs(path.join(f.user,'blocked'),'test');blocked.add(logs.view().entries[0]);await blocked.flush();expect(blocked.view().error).toBeTruthy();
  }finally{await f.cleanup()}
});

it('知识校验错误计数刷新后消失，不再留存启动时的泛化警告',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),file=path.join(f.a,'.cbim/README.md');
    await fs.writeFile(file,'# Bad\n[invalid](../../../outside.md)');await ws.snapshot();expect(ws.view().knowledgeErrors).toBeGreaterThan(0);expect(ws.error).toBeUndefined();
    await fs.writeFile(file,'# Fixed');await ws.snapshot();expect(ws.view().knowledgeErrors).toBe(0);
  }finally{await f.cleanup()}
});
