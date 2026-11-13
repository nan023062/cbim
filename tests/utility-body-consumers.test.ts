import {expect,it,vi} from 'vitest';
import {RemoteRepository} from '../src/backend/main/resources/resource-http';
import {githubRequest} from '../src/backend/main/feedback/github-api';
import {readUrlSource} from '../src/backend/main/materials/chat-source-readers';
import {releaseRequest} from '../src/backend/updater/release-http';
import {downloadRuntimeManifest} from '../src/backend/updater/runtime-download';
import {MAX_BYTES} from '../src/backend/main/resources/resource-store';

// 所有断言围绕同一组合契约：utility 的取消事实由调用方映射，不丢失原业务错误或触发重发。
const consumers:Array<{name:string;code?:string;read:(signal:AbortSignal)=>Promise<unknown>}>= [
  {name:'repository',code:'CANCELLED',read:signal=>new RemoteRepository('http://127.0.0.1','private-token').read(signal)},
  {name:'github',code:'GITHUB_NETWORK',read:signal=>githubRequest('https://api.github.com/user',{method:'GET',signal,token:'private-token'})},
  {name:'materials',read:signal=>readUrlSource('web','https://example.com/page',signal)},
  {name:'release',read:signal=>releaseRequest('https://api.github.com/repos/nan023062/cbim/releases',{method:'GET',signal})},
  {name:'manifest',read:signal=>downloadRuntimeManifest('runtime-test','manifest.json',signal)},
];
it.each(consumers)('$name：fetch 不转发取消时仍结束挂起正文，保留错误归属且不重发',async consumer=>{
  let ready!:()=>void;const arrived=new Promise<void>(resolve=>ready=resolve),stop=new AbortController(),reason=Error('PRIVATE_CANCEL_REASON');
  const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'))},pull(){ready();return new Promise<void>(()=>{})},cancel},{highWaterMark:0});
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body,{headers:{'content-type':'text/plain'}}));
  try{
    const read=consumer.read(stop.signal);const rejected=consumer.code?expect(read).rejects.toMatchObject({code:consumer.code}):expect(read).rejects.toBe(reason);
    await arrived;stop.abort(reason);await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
  }finally{stop.abort();fetch.mockRestore()}
},2000);

it.each([
  {name:'repository',maxBytes:MAX_BYTES+65536,error:{code:'SIZE'}},
  {name:'github',maxBytes:2*1024*1024,error:{code:'GITHUB_NETWORK'}},
  {name:'materials',maxBytes:1024*1024,error:{code:'ATTACHMENT_WEB_LIMIT'}},
  {name:'release',maxBytes:2*1024*1024,error:{message:'更新列表过大'}},
  {name:'manifest',maxBytes:16*1024*1024,error:{message:'更新清单超过上限'}},
])('$name：字节超限仍映射原业务错误，取消正文并释放锁',async item=>{
  const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(item.maxBytes+1))},cancel});
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body,{headers:{'content-type':'text/plain'}}));
  try{
    await expect(consumers.find(value=>value.name===item.name)!.read(new AbortController().signal)).rejects.toMatchObject(item.error);
    expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
  }finally{fetch.mockRestore()}
});
it('更新清单完整返回 JSON，保留缺正文拒绝和公开无凭据请求',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('{"payload":"原始字节"}')).mockResolvedValueOnce(new Response(null));
  try{
    expect(await downloadRuntimeManifest('runtime-test','manifest.json',new AbortController().signal)).toEqual({payload:'原始字节'});
    expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'manual'});
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
    await expect(downloadRuntimeManifest('runtime-test','manifest.json',new AbortController().signal)).rejects.toThrow('更新清单为空');
  }finally{fetch.mockRestore()}
});
