import {afterEach,it,expect,vi} from 'vitest';
import {releaseRequest} from '../src/logic/updates/service/release-http';
const endpoint='https://api.github.com/repos/nan023062/cbim/releases?per_page=30&page=1';
const options=()=>({method:'GET' as const,signal:new AbortController().signal});
afterEach(()=>vi.unstubAllGlobals());
it('reads public releases without sharing runtime credentials or following redirects',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response('[]',{status:200}));vi.stubGlobal('fetch',fetcher);
  expect(await releaseRequest(endpoint,options())).toEqual({status:200,data:[]});
  const init=fetcher.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('GET');expect(init.redirect).toBe('error');expect(init.headers).not.toHaveProperty('Authorization');expect(init.body).toBeUndefined();
});
it('rejects other hosts, repositories and credential-bearing URLs before network access',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const url of ['https://evil.test/repos/nan023062/cbim/releases','https://api.github.com/repos/other/repo/releases','https://user:pass@api.github.com/repos/nan023062/cbim/releases'])await expect(releaseRequest(url,options())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('bounds release responses and fails on malformed JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(2*1024*1024+1))));await expect(releaseRequest(endpoint,options())).rejects.toThrow();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('invalid')));await expect(releaseRequest(endpoint,options())).rejects.toThrow();
});
