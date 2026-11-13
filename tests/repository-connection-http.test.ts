import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {LocalRepository} from '../src/logic/resources/service';
import {RemoteRepository,serveRepository} from '../src/logic/resources/service';

it('生产共享服务的只读令牌实际允许GET但拒绝POST/DELETE，不改变真实仓库',async()=>{
  const f=await fixture(),folder=path.join(f.temp,'readonly-repo');await fs.mkdir(folder);const store=new LocalRepository(folder),initial=await store.initialize(),readToken='reader-token-with-enough-bytes',writeToken='writer-token-with-enough-bytes';
  const serving=await serveRepository(store,writeToken,{host:'127.0.0.1',port:0,readOnlyToken:readToken});try{
    const reader=new RemoteRepository(serving.url,readToken,initial.repositoryId),writer=new RemoteRepository(serving.url,writeToken,initial.repositoryId),item={kind:'skill',name:'真实资料',summary:'',content:'# Kept'};
    expect(await reader.read()).toEqual(initial);
    await expect(reader.save({repositoryId:initial.repositoryId,revision:initial.revision,item})).rejects.toMatchObject({code:'FORBIDDEN'});
    const saved=await writer.save({repositoryId:initial.repositoryId,revision:initial.revision,item});expect(saved.items).toHaveLength(1);
    await expect(reader.remove({repositoryId:saved.repositoryId,revision:saved.revision,id:saved.items[0].id})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await store.read()).toEqual(saved);expect(await reader.read()).toEqual(saved);
  }finally{await serving.close();await f.cleanup()}
});

it('RemoteRepository取消覆盖已收到响应头的正文流，不等待8秒也不重试',async()=>{
  let calls=0,opened!:()=>void;const arrived=new Promise<void>(resolve=>opened=resolve),server=http.createServer((_req,res)=>{calls++;res.writeHead(200,{'Content-Type':'application/json'});res.write('{');opened()});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const controller=new AbortController(),client=new RemoteRepository('http://127.0.0.1:'+(server.address() as any).port,'secret-do-not-echo');
  try{const read=client.read(controller.signal);await arrived;controller.abort(Error('PRIVATE_CANCEL_REASON'));await expect(read).rejects.toMatchObject({code:'CANCELLED'});expect(calls).toBe(1)}finally{const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed}
});

it('真实8秒超时覆盖挂起正文；超时没有自动重试且不泄露凭据',async()=>{
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['--import','tsx','tests/repository-connection-http-child.ts'],{windowsHide:true,timeout:15_000,maxBuffer:4096}).catch((error:any)=>{
    // Vitest 的普通 Error 输出不展示 execFile 附带的 stdout/stderr；保留业务结果以区分请求未返回与进程未退出。
    throw Error('HTTP timeout fixture did not exit: '+JSON.stringify({code:error.code,signal:error.signal,killed:error.killed,stdout:error.stdout,stderr:error.stderr}));
  });
  const result=JSON.parse(stdout);expect(stderr).toBe('');expect(result).toMatchObject({cancellation:'CANCELLED',code:'TIMEOUT',calls:2,leaked:false});expect(result.elapsedMs).toBeGreaterThanOrEqual(7900);expect(result.elapsedMs).toBeLessThan(12_000);
},18_000);

it('fetch未向正文转发取消时仍显式取消reader并释放锁，不交付半截正文',async()=>{
  let reading!:()=>void,source!:ReadableStreamDefaultController<Uint8Array>;const arrived=new Promise<void>(resolve=>reading=resolve),cancel=vi.fn();
  const body=new ReadableStream<Uint8Array>({start(controller){source=controller;controller.enqueue(new TextEncoder().encode('{'))},pull(){reading()},cancel});
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body)),controller=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
    const read=new RemoteRepository('http://127.0.0.1','private-test-token').read(controller.signal);await arrived;controller.abort();
    await expect(Promise.race([read,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('body read remained pending')),1000)})])).rejects.toMatchObject({code:'CANCELLED'});
    expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
  }finally{clearTimeout(deadline);source.error(Error('fixture cleanup'));fetch.mockRestore()}
});

it('停止与重新共享永久退役旧只读端口，新代际仍经过HTTP',async()=>{
  const f=await fixture();try{const folder=path.join(f.temp,'repo');await fs.mkdir(folder);await f.app.resources.configure({mode:'local',location:folder});await f.app.resources.startSharing({lan:false,port:0});const id=f.app.resources.status().config!.repositoryId,first=f.app.resources.readConnection(id),read=vi.spyOn(RemoteRepository.prototype,'read');
    try{await first.read();expect(read).toHaveBeenCalledTimes(1);await f.app.resources.stopSharing();await expect(first.read()).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});await f.app.resources.startSharing({lan:false,port:0});const next=f.app.resources.readConnection(id);expect(next.connectionId).not.toBe(first.connectionId);await expect(first.read()).rejects.toMatchObject({code:'REPOSITORY_CONNECTION_STALE'});await next.read();expect(read).toHaveBeenCalledTimes(2)}finally{read.mockRestore()}
  }finally{await f.cleanup()}
});
