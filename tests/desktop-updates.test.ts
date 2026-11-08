import {describe,it,expect,vi} from 'vitest';
import {DesktopUpdates,type DesktopUpdateInstaller} from '../src/backend/updater/desktop-updates';
import {compareDesktopVersions,parseDesktopRelease,latestDesktopRelease,desktopReleaseBase,desktopInstallerName} from '../src/backend/updater/desktop-releases';
import type {DesktopRelease} from '../src/bridge/contracts/desktop-updates';
import type {ReleaseRequest} from '../src/backend/updater/release-http';

const release:DesktopRelease={version:'0.2.0',tag:'desktop-v0.2.0',notes:'修复与功能',publishedAt:'2026-11-08T00:00:00Z'};
function wire(version='0.2.0') {return {draft:false,prerelease:false,tag_name:'desktop-v'+version,html_url:'https://github.com/nan023062/cbim/releases/tag/desktop-v'+version,published_at:release.publishedAt,body:release.notes,assets:[desktopInstallerName(version),'latest.yml'].map(name=>({name,state:'uploaded',size:100,browser_download_url:desktopReleaseBase(version)+name}))}}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
function fixture(latest=vi.fn(async()=>release),enabled=true){
  const port={prepare:vi.fn(async()=>{}),download:vi.fn(async(onProgress:(n:number)=>void)=>onProgress(100)),install:vi.fn(),close:vi.fn()} satisfies DesktopUpdateInstaller;
  return {port,latest,service:new DesktopUpdates('0.1.0','本版日志',enabled,latest,port)};
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
describe('manual desktop updates',()=>{
  it('checks after startup and every 30 minutes without downloading',async()=>{vi.useFakeTimers();const f=fixture();try{f.service.start();await vi.advanceTimersByTimeAsync(9999);expect(f.latest).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(f.latest).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(30*60*1000);expect(f.latest).toHaveBeenCalledTimes(2);expect(f.port.prepare).not.toHaveBeenCalled()}finally{f.service.close();vi.useRealTimers()}});
  it('does no work for development/portable builds',async()=>{const f=fixture(undefined,false);f.service.start();await f.service.check();await f.service.download();await f.service.install(async()=>{});expect(f.latest).not.toHaveBeenCalled();expect(f.port.prepare).not.toHaveBeenCalled();expect(f.service.status().phase).toBe('disabled');f.service.close()});
  it('check does not download and a checked download does not install',async()=>{const f=fixture();await f.service.check();expect(f.service.status().phase).toBe('available');expect(f.port.prepare).not.toHaveBeenCalled();await f.service.download();expect(f.service.status().phase).toBe('ready');expect(f.port.install).not.toHaveBeenCalled();f.service.close();expect(f.port.install).not.toHaveBeenCalled()});
  it('rejects downgrade and same-version installation',async()=>{for(const version of ['0.0.9','0.1.0']){const f=fixture(vi.fn(async()=>({...release,version})));await f.service.check();await f.service.download();expect(f.service.status().phase).toBe('current');expect(f.port.prepare).not.toHaveBeenCalled()}});
  it('keeps checked candidate after a network failure',async()=>{const f=fixture();await f.service.check();f.latest.mockRejectedValueOnce(Error('network'));await f.service.check();expect(f.service.status()).toMatchObject({phase:'available',release,error:expect.any(String)})});
  it('coalesces parallel checks',async()=>{const pending=deferred<DesktopRelease>();const f=fixture(vi.fn(()=>pending.promise));const a=f.service.check(),b=f.service.check();expect(a).toBe(b);pending.resolve(release);await a;expect(f.latest).toHaveBeenCalledTimes(1)});
  it('freezes downloaded version and ignores automatic checks',async()=>{const f=fixture();await f.service.check();await f.service.download();await f.service.check();expect(f.latest).toHaveBeenCalledTimes(1);expect(f.service.status().release).toEqual(release)});
  it('duplicates cannot start a second download or install while downloading',async()=>{const wait=deferred<void>();const f=fixture();f.port.download.mockImplementationOnce(()=>wait.promise);await f.service.check();const a=f.service.download(),b=f.service.download();await Promise.resolve();const stop=vi.fn(async()=>{});void f.service.install(stop);expect(a).toBe(b);wait.resolve();await a;expect(f.port.download).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled()});
  it('download failure remains retryable only by an explicit download',async()=>{const f=fixture();f.port.download.mockRejectedValueOnce(Error('checksum'));await f.service.check();await f.service.download();expect(f.service.status().phase).toBe('available');expect(f.port.install).not.toHaveBeenCalled();await f.service.download();expect(f.port.prepare).toHaveBeenCalledTimes(2);expect(f.service.status().phase).toBe('ready')});
  it('shutdown failure never installs and later explicit retry can succeed',async()=>{const f=fixture();await f.service.check();await f.service.download();await f.service.install(async()=>{throw Error('drain pending')});expect(f.port.install).not.toHaveBeenCalled();expect(f.service.status().phase).toBe('ready');const shutdown=vi.fn(async()=>{});await f.service.install(shutdown);expect(shutdown).toHaveBeenCalledOnce();expect(f.port.install).toHaveBeenCalledOnce();expect(f.service.status().phase).toBe('installing')});
  it('waits for real shutdown before invoking installer',async()=>{const f=fixture(),shutdown=deferred<void>();await f.service.check();await f.service.download();const install=f.service.install(()=>shutdown.promise);expect(f.port.install).not.toHaveBeenCalled();shutdown.resolve();await install;expect(f.port.install).toHaveBeenCalledOnce()});
  it('closing during preparation prevents late download',async()=>{const f=fixture(),wait=deferred<void>();f.port.prepare.mockImplementationOnce(()=>wait.promise);await f.service.check();const download=f.service.download();f.service.close();wait.resolve();await download;expect(f.port.download).not.toHaveBeenCalled();expect(f.port.install).not.toHaveBeenCalled()});
});
