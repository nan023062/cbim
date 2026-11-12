import {EventEmitter} from 'node:events';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({instances:[] as any[],reply:undefined as any}));
vi.mock('electron-updater',()=>({NsisUpdater:class extends EventEmitter{
  args:unknown;autoDownload=true;autoInstallOnAppQuit=true;allowDowngrade=true;allowPrerelease=true;disableWebInstaller=false;disableDifferentialDownload=true;
  constructor(args:unknown){super();this.args=args;state.instances.push(this)}
  async checkForUpdates(){return state.reply}
  downloadUpdate=vi.fn(async()=>['private-installer-path']);quitAndInstall=vi.fn();
}}));
import {NsisUpdateInstaller} from '../src/backend/updater/nsis-updater';
const release={version:'0.2.0',tag:'desktop-v0.2.0',notes:'',publishedAt:'2026-11-08T00:00:00Z'};
beforeEach(()=>{state.instances.length=0;state.reply={isUpdateAvailable:true,cancellationToken:{cancel:vi.fn()},updateInfo:{version:'0.2.0',files:[{url:'CBIM-Setup-0.2.0-x64.exe',sha512:'checksum'}]}}});
it('uses a fixed feed, single-range differential downloads and no implicit installation',async()=>{const port=new NsisUpdateInstaller();await port.prepare(release);expect(state.instances[0]).toMatchObject({autoDownload:false,autoInstallOnAppQuit:false,allowDowngrade:false,allowPrerelease:false,disableWebInstaller:true,disableDifferentialDownload:false,args:{provider:'generic',url:'https://github.com/nan023062/cbim/releases/download/desktop-v0.2.0/',useMultipleRangeRequest:false}});expect(()=>port.install()).toThrow();await port.download(()=>{});expect(state.instances[0].quitAndInstall).not.toHaveBeenCalled();port.install();expect(state.instances[0].quitAndInstall).toHaveBeenCalledWith(true,true)});
it('rejects a manifest for another version or remote executable',async()=>{for(const change of [{version:'0.3.0'},{files:[{url:'https://evil.test/install.exe',sha512:'checksum'}]},{packages:{x64:{path:'payload'}}},{files:[]}]){const port=new NsisUpdateInstaller();const previous=state.reply.updateInfo;state.reply.updateInfo={...previous,...change};await expect(port.prepare(release)).rejects.toThrow();state.reply.updateInfo=previous}});
it('closes by cancellation and never invokes installation',async()=>{const port=new NsisUpdateInstaller();await port.prepare(release);await port.download(()=>{});port.close();expect(state.reply.cancellationToken.cancel).toHaveBeenCalled();expect(state.instances[0].quitAndInstall).not.toHaveBeenCalled();expect(()=>port.install()).toThrow()});
