import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DesktopUpdates,type DesktopUpdateInstaller} from '../../../../../src/logic-new/updates/service/desktop-updates';
import {compareDesktopVersions,parseDesktopRelease,latestDesktopRelease} from '../../../../../src/logic-new/updates/service/desktop-releases';
import type {DesktopRelease} from '../../../../../src/bridge/contracts/desktop-updates';
import type {ReleaseRequest} from '../../../../../src/logic-new/updates/service/release-http';

import {desktopReleaseBase,desktopInstallerName} from '../../../../../src/updater/release-policy';

const release:DesktopRelease={version:'0.2.0',tag:'desktop-v0.2.0',notes:'修复与功能',publishedAt:'2026-11-08T00:00:00Z'};
function wire(version='0.2.0') {return {draft:false,prerelease:false,tag_name:'desktop-v'+version,html_url:'https://github.com/nan023062/cbim/releases/tag/desktop-v'+version,published_at:release.publishedAt,body:release.notes,assets:[desktopInstallerName(version),'latest.yml'].map(name=>({name,state:'uploaded',size:100,browser_download_url:desktopReleaseBase(version)+name}))}}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
const services:DesktopUpdates[]=[];
function fixture(latest=vi.fn(async()=>release),enabled=true){
  const port={Prepare:vi.fn(async()=>{}),Download:vi.fn(async(onProgress:(n:number)=>void)=>onProgress(100)),Install:vi.fn(),Close:vi.fn()} satisfies DesktopUpdateInstaller;
  const shutdown=vi.fn(async()=>{}),service=new DesktopUpdates('0.1.0','本版日志',enabled,latest,port,shutdown);services.push(service);
  return {port,latest,shutdown,service};
}
describe('desktop stable release selection',()=>{
  it('compares numeric segments and rejects invalid stable versions',()=>{expect(compareDesktopVersions('0.10.0','0.9.9')).toBe(1);expect(compareDesktopVersions('0.1.0','0.1.0')).toBe(0);for(const v of ['1.2.3-beta','01.2.3','../1.2','1.2.3/evil'])expect(()=>compareDesktopVersions(v,'0.1.0')).toThrow()});
  it('accepts only matching repository/platform release with uploaded assets',()=>{
    expect(parseDesktopRelease(wire())).toEqual(release);
    for(const change of [{draft:true},{prerelease:true},{tag_name:'v1.0.2'},{html_url:'https://evil.test'},{assets:[]},{published_at:'bad'}])expect(parseDesktopRelease({...wire(),...change})).toBeUndefined();
    const invalid=wire();invalid.assets[0].browser_download_url='https://evil.test/install.exe';expect(parseDesktopRelease(invalid)).toBeUndefined();
  });
  it('does not accept duplicate or incomplete installer assets',()=>{const raw=wire();raw.assets.push(raw.assets[0]);expect(parseDesktopRelease(raw)).toBeUndefined();const missing=wire();missing.assets[0].size=0;expect(parseDesktopRelease(missing)).toBeUndefined()});
  it('reads public releases without credential and chooses newest stable desktop version',async()=>{
    const request=vi.fn<ReleaseRequest>(async()=>({status:200,data:[{...wire(),tag_name:'v8.0.0'},wire('0.9.0'),wire('0.10.0'),{...wire('1.0.0'),prerelease:true}]}));
    expect((await latestDesktopRelease(new AbortController().signal,request))?.version).toBe('0.10.0');expect(request.mock.calls[0][1]).not.toHaveProperty('token');
  });
  it('does not silently hide a failed API read',async()=>{await expect(latestDesktopRelease(new AbortController().signal,async()=>({status:403,data:{}}))).rejects.toThrow()});
});
describe('background downloads and user-confirmed installation',()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>{for(const service of services)service.Close();services.length=0;vi.useRealTimers()});
  async function settle<T>(job:Promise<T>){await vi.advanceTimersByTimeAsync(0);return job}
  it('retries offline checks at the next minute, prefetches and never installs on a timer',async()=>{
    const f=fixture();f.latest.mockRejectedValueOnce(Error('offline'));f.service.Start();f.service.Start();
    await vi.advanceTimersByTimeAsync(9999);expect(f.latest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(f.service.Status()).toMatchObject({phase:'idle',checkedAt:expect.any(String),error:expect.any(String)});
    await vi.advanceTimersByTimeAsync(50000);expect(f.latest).toHaveBeenCalledTimes(2);
    expect(f.service.Status()).toMatchObject({phase:'ready',progress:100,error:undefined});
    await vi.advanceTimersByTimeAsync(120000);expect(f.port.Prepare).toHaveBeenCalledOnce();expect(f.port.Download).toHaveBeenCalledOnce();
    expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled();
  });
  it('does no work for development/portable builds',async()=>{const f=fixture(undefined,false);f.service.Start();await f.service.Check();await f.service.Download();await f.service.Install();await vi.advanceTimersByTimeAsync(120000);expect(f.latest).not.toHaveBeenCalled();expect(f.port.Prepare).not.toHaveBeenCalled();expect(f.service.Status().phase).toBe('disabled')});
  it('prefetch only stages a package; an explicit install yields once and awaits actual drain',async()=>{
    const f=fixture();await f.service.Check();expect(f.service.Status()).toMatchObject({phase:'ready',progress:100});
    await f.service.Download();await vi.advanceTimersByTimeAsync(120000);expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled();
    const job=f.service.Install();expect(f.service.Status().phase).toBe('installing');
    expect(f.shutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);await job;expect(f.shutdown).toHaveBeenCalledOnce();expect(f.port.Install).toHaveBeenCalledOnce();
  });
  it('rejects downgrade and same-version installation',async()=>{for(const version of ['0.0.9','0.1.0']){const f=fixture(vi.fn(async()=>({...release,version})));await f.service.Check();await f.service.Download();expect(f.service.Status().phase).toBe('current');expect(f.port.Prepare).not.toHaveBeenCalled()}});
  it('keeps an advertised candidate and records the failed check time',async()=>{const f=fixture();f.port.Download.mockRejectedValueOnce(Error('network'));await f.service.Check();const time=f.service.Status().checkedAt;await vi.advanceTimersByTimeAsync(1000);f.latest.mockRejectedValueOnce(Error('network'));await f.service.Check();expect(f.service.Status()).toMatchObject({phase:'available',release,error:expect.any(String)});expect(f.service.Status().checkedAt).not.toBe(time)});
  it('coalesces parallel checks',async()=>{const pending=deferred<DesktopRelease>();const f=fixture(vi.fn(()=>pending.promise));const a=f.service.Check(),b=f.service.Check();expect(a).toBe(b);pending.resolve(release);await a;expect(f.latest).toHaveBeenCalledTimes(1)});
  it('freezes a ready candidate after failure and never retries installation on timer checks',async()=>{const f=fixture();f.shutdown.mockRejectedValueOnce(Error('drain'));f.service.Start();await f.service.Check();await settle(f.service.Install());expect(f.service.Status().phase).toBe('ready');await vi.advanceTimersByTimeAsync(120000);await f.service.Check();expect(f.latest).toHaveBeenCalledTimes(1);expect(f.service.Status().release).toEqual(release);expect(f.shutdown).toHaveBeenCalledOnce();expect(f.port.Install).not.toHaveBeenCalled()});
  it('coalesces prefetch and manual downloads without queuing an early install',async()=>{
    const wait=deferred<void>(),f=fixture();f.port.Download.mockImplementationOnce(()=>wait.promise);
    const a=f.service.Check();await vi.advanceTimersByTimeAsync(0);
    expect(f.service.Download()).toBe(a);expect(f.service.Install()).toBe(a);await f.service.Check();
    wait.resolve();await a;expect(f.port.Download).toHaveBeenCalledOnce();expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled();
    const install=f.service.Install();expect(f.service.Install()).toBe(install);await settle(install);await f.service.Install();expect(f.port.Install).toHaveBeenCalledOnce();
  });
  it('checksum failure cools down background retries but manual retry only stages the package',async()=>{
    const f=fixture();f.port.Download.mockRejectedValueOnce(Error('checksum'));await f.service.Check();
    expect(f.service.Status()).toMatchObject({phase:'available',error:expect.any(String)});expect(f.shutdown).not.toHaveBeenCalled();
    await f.service.Check();expect(f.port.Prepare).toHaveBeenCalledOnce();expect(f.service.Status().error).toBeTruthy();
    await f.service.Download();expect(f.port.Prepare).toHaveBeenCalledTimes(2);expect(f.service.Status().phase).toBe('ready');expect(f.port.Install).not.toHaveBeenCalled();
  });
  it('automatically retries failed downloads after five minutes, without restarting',async()=>{
    const f=fixture();f.port.Download.mockRejectedValueOnce(Error('network'));f.service.Start();await f.service.Check();
    await vi.advanceTimersByTimeAsync(299999);expect(f.port.Download).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);expect(f.port.Download).toHaveBeenCalledTimes(2);expect(f.service.Status().phase).toBe('ready');expect(f.port.Install).not.toHaveBeenCalled();
  });
  it('a newer candidate bypasses the failed previous download cooldown',async()=>{
    const f=fixture();f.port.Download.mockRejectedValueOnce(Error('network'));await f.service.Check();
    f.latest.mockResolvedValueOnce({...release,version:'0.3.0',tag:'desktop-v0.3.0'});await f.service.Check();
    expect(f.port.Prepare).toHaveBeenLastCalledWith(expect.objectContaining({version:'0.3.0'}));expect(f.service.Status().phase).toBe('ready');expect(f.port.Install).not.toHaveBeenCalled();
  });
  it('shutdown failure retains the verified package for explicit install-only retry',async()=>{const f=fixture();f.shutdown.mockRejectedValueOnce(Error('drain pending'));await f.service.Check();await settle(f.service.Install());expect(f.port.Install).not.toHaveBeenCalled();expect(f.service.Status()).toMatchObject({phase:'ready',error:expect.any(String)});await settle(f.service.Install());expect(f.shutdown).toHaveBeenCalledTimes(2);expect(f.port.Prepare).toHaveBeenCalledOnce();expect(f.port.Install).toHaveBeenCalledOnce();expect(f.service.Status().phase).toBe('installing')});
  it('waits for actual shutdown completion before invoking the installer',async()=>{const f=fixture(),shutdown=deferred<void>();f.shutdown.mockImplementationOnce(()=>shutdown.promise);await f.service.Check();const job=f.service.Install();await vi.advanceTimersByTimeAsync(2000);expect(f.shutdown).toHaveBeenCalledOnce();expect(f.port.Install).not.toHaveBeenCalled();shutdown.resolve();await job;expect(f.port.Install).toHaveBeenCalledOnce()});
  it('closing during preparation prevents late download and installation',async()=>{const f=fixture(),wait=deferred<void>();f.port.Prepare.mockImplementationOnce(()=>wait.promise);const job=f.service.Check();await vi.advanceTimersByTimeAsync(0);f.service.Close();wait.resolve();await job;expect(f.port.Download).not.toHaveBeenCalled();expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled()});
  it('closing during a download cannot turn its late result into an installation',async()=>{const f=fixture(),wait=deferred<void>();f.port.Download.mockImplementationOnce(()=>wait.promise);const job=f.service.Check();await vi.advanceTimersByTimeAsync(0);f.service.Close();wait.resolve();await job;expect(f.service.Status().phase).toBe('disabled');expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled()});
  it('closing after prefetch does not install a ready package',async()=>{const f=fixture();await f.service.Check();f.service.Close();await f.service.Install();await vi.advanceTimersByTimeAsync(120000);expect(f.port.Install).not.toHaveBeenCalled();expect(f.shutdown).not.toHaveBeenCalled()});
  it('normal exit before the restart yield cancels the pending upgrade',async()=>{const f=fixture();await f.service.Check();const job=f.service.Install();f.service.Close();await vi.advanceTimersByTimeAsync(0);await job;await vi.advanceTimersByTimeAsync(120000);expect(f.shutdown).not.toHaveBeenCalled();expect(f.port.Install).not.toHaveBeenCalled();f.service.Start();await vi.advanceTimersByTimeAsync(120000);expect(f.latest).toHaveBeenCalledOnce()});
  it('normal exit during shutdown prevents a late installer call',async()=>{const f=fixture(),shutdown=deferred<void>();f.shutdown.mockImplementationOnce(()=>shutdown.promise);await f.service.Check();const job=f.service.Install();await vi.advanceTimersByTimeAsync(2000);f.service.Close();shutdown.resolve();await job;expect(f.port.Install).not.toHaveBeenCalled()});
  it('installer rejection requires a new explicit retry and does not redownload',async()=>{const f=fixture();f.port.Install.mockImplementationOnce(()=>{throw Error('installer unavailable')});await f.service.Check();await settle(f.service.Install());expect(f.service.Status().phase).toBe('ready');await settle(f.service.Install());expect(f.port.Install).toHaveBeenCalledTimes(2);expect(f.port.Download).toHaveBeenCalledOnce()});
});
