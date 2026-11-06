import {it,expect} from 'vitest';
import {fixture,request} from './helpers';
import {readJson} from '../src/backend/core/foundation/files';
import {McpMonitor} from '../src/backend/main/integrations/mcp/mcp-status';

it('流量速率在空闲后归零，累计字节保留',()=>{
  let now=10000;const monitor=new McpMonitor('test',()=>now);monitor.start();monitor.bytes(100,250);monitor.finish(false);
  expect(monitor.view()).toMatchObject({receivedBytes:100,sentBytes:250,receiveRate:20,sendRate:50,requests:1,inFlight:0});
  now+=6000;expect(monitor.view()).toMatchObject({receivedBytes:100,sentBytes:250,receiveRate:0,sendRate:0});
});

it('HTTP 正文流量按工作区独立计数，真实心跳更新健康状态但不产生业务活动',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});const wa=f.app.workspace(a.id),wb=f.app.workspace(b.id);
    const d=await readJson(f.app.paths.discovery(a.id));const initial=wa.mcp.view();expect(initial).toMatchObject({health:'online',requests:0,receivedBytes:0,sentBytes:0});expect(initial.lastActivityAt).toBeUndefined();
    const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'流量测试',version:'1'}}});
    const response=await fetch(d.url,{method:'POST',headers:{Authorization:'Bearer '+wa.readToken,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body});
    const text=await response.text();expect(response.status).toBe(200);expect(JSON.parse(text).result.serverInfo).toBeTruthy();
    expect(wa.mcp.view()).toMatchObject({requests:1,receivedBytes:Buffer.byteLength(body),sentBytes:Buffer.byteLength(text),inFlight:0,errors:0});
    expect(wb.mcp.view()).toMatchObject({requests:0,receivedBytes:0,sentBytes:0});
    const traffic=wa.mcp.view();await new Promise(r=>setTimeout(r,5200));
    expect(wa.mcp.view().checkedAt).not.toBe(initial.checkedAt);expect(wa.mcp.view()).toMatchObject({health:'online',requests:traffic.requests,receivedBytes:traffic.receivedBytes,sentBytes:traffic.sentBytes,lastActivityAt:traffic.lastActivityAt});
    await fetch(d.url);expect(wa.mcp.view().errors).toBe(1);
  }finally{await f.cleanup()}
});

it('主动重启合并重复请求，仅更换目标实例，保留知识并关闭写权限',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});const wa=f.app.workspace(a.id),wb=f.app.workspace(b.id);
    wa.writable=true;const before=await wa.read(),old=await readJson(f.app.paths.discovery(a.id)),peer=await readJson(f.app.paths.discovery(b.id));
    const [one,two]=await Promise.all([f.app.dispatch('restartMcp',{id:a.id}),f.app.dispatch('restartMcp',{id:a.id})]);
    expect(one.instanceId).toBe(two.instanceId);expect(one.instanceId).not.toBe(wa.instanceId);expect(one.writable).toBe(false);expect(one.mcp).toMatchObject({health:'online',requests:0});
    expect((await f.app.workspace(a.id).read()).revision).toBe(before.revision);expect(f.app.workspace(b.id)).toBe(wb);expect(await readJson(f.app.paths.discovery(b.id))).toEqual(peer);
    await expect(fetch(old.url)).rejects.toThrow();expect((await fetch(peer.url)).status).toBe(401);
    expect((await readJson(f.app.paths.discovery(a.id))).url).not.toBe(old.url);
  }finally{await f.cleanup()}
});

it('重启等待正在提交的事务完成，不丢失提交成果',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(a.id),snapshot=await ws.read();
    let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
    const validate=ws.rules.validate.bind(ws.rules);let once=true;ws.rules.validate=async(...args)=>{if(once){once=false;started();await gate}return validate(...args)};
    const commit=ws.commit(request(snapshot,[{path:'.cbim/README.md',text:'# durable restart'}]));await entered;
    const restarting=f.app.dispatch('restartMcp',{id:a.id});
    try{for(let i=0;i<100&&ws.state!=='closing';i++)await new Promise(r=>setTimeout(r,1));expect(ws.state).toBe('closing')}finally{release()}
    expect((await commit).state).toBe('committed');await restarting;
    expect((await f.app.workspace(a.id).read()).files.find(f=>f.path==='.cbim/README.md')?.text).toBe('# durable restart');
  }finally{await f.cleanup()}
});
