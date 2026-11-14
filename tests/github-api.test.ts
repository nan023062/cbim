import {afterEach,describe,expect,it,vi} from 'vitest';
import {githubRequest} from '../src/logic/feedback/service/github-api';
const token='gho_testOnlyPrivateCredential';
const signal=()=>new AbortController().signal;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
describe('GitHub transport boundary',()=>{
  it('uses fixed hosts, refuses redirects and bounds responses without exposing tokens',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('{"ok":true}',{status:200}));vi.stubGlobal('fetch',fetchMock);
    await expect(githubRequest('https://other.test/repos/x',{method:'GET',token,signal:signal()})).rejects.toMatchObject({code:'GITHUB_ADDRESS'});expect(fetchMock).not.toHaveBeenCalled();
    await githubRequest('https://api.github.com/user',{method:'GET',token,signal:signal()});expect(fetchMock.mock.calls[0][1]).toMatchObject({redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'}});
    fetchMock.mockRejectedValue(Error(token));await expect(githubRequest('https://api.github.com/user',{method:'GET',token,signal:signal()})).rejects.toMatchObject({code:'GITHUB_NETWORK',message:expect.not.stringContaining(token)});
    fetchMock.mockResolvedValue(new Response('x'.repeat(2*1024*1024+1)));await expect(githubRequest('https://api.github.com/user',{method:'GET',token,signal:signal()})).rejects.toMatchObject({code:'GITHUB_NETWORK'});
  });
});
