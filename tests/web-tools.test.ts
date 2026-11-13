import {expect,it,vi} from 'vitest';
import {WebTools} from '../src/backend/scheduler-engine/tools/web-tools';
const signal=()=>new AbortController().signal;

it('工具严格输入、有界输出、只读分类且只调用一次，取消不返回结果',async()=>{
  const fetch=vi.fn(async()=>({url:'https://example.com/',title:'标题',markdown:'正文',truncated:false,cached:false,capturedAt:new Date().toISOString(),untrusted:true as const}));
  const tools=new WebTools({fetch,search:vi.fn()},'workspace');expect(tools.describe('cbim_web_fetch',{url:'https://example.com'})).toMatchObject({effects:['read'],native:false});
  expect(()=>tools.describe('cbim_web_fetch',{url:'https://example.com',headers:{Cookie:'secret'}})).toThrow();
  await tools.call('cbim_web_fetch',{url:'https://example.com'},signal());expect(fetch).toHaveBeenCalledTimes(1);
  const controller=new AbortController();controller.abort();await expect(tools.call('cbim_web_fetch',{url:'https://example.com'},controller.signal)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});