import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ElectronHttpExecutor} from 'electron-updater/out/electronHttpExecutor';
import type {AppAdapter} from 'electron-updater/out/AppAdapter';
import type {NsisUpdater} from 'electron-updater';
import {desktopInstallerName,desktopReleaseBase} from '../src/backend/updater/desktop-releases';

// 只替换宿主和网络边界；版本解析、差分计划、Range 下载、SHA-512、缓存和全量回退均用真实依赖。
const state=vi.hoisted(()=>({app:undefined as AppAdapter|undefined,executor:undefined as ElectronHttpExecutor|undefined,updater:undefined as NsisUpdater|undefined}));
vi.mock('electron-updater',async importOriginal=>{
  const original=await importOriginal<typeof import('electron-updater')>();
  return {NsisUpdater:class extends original.NsisUpdater{
    constructor(options:ConstructorParameters<typeof original.NsisUpdater>[0]){
      super(undefined,state.app);
      Object.assign(this,{httpExecutor:state.executor});
      this.setFeedURL(options!);
      state.updater=this;
    }
    // 测试中的包只是字节夹具，绝不启动安装器或退出任何真实客户端。
    quitAndInstall=vi.fn();
  }};
});
import {NsisUpdateInstaller} from '../src/backend/updater/nsis-updater';

const oldVersion='0.1.9',newVersion='0.2.0';
const release={version:newVersion,tag:'desktop-v'+newVersion,notes:'',publishedAt:'2026-11-12T00:00:00Z'};
const oldBlocks=[...'ABCDEFGH'].map(value=>Buffer.alloc(8192,value));
const newBlocks=oldBlocks.map((block,index)=>index===1||index===5?Buffer.alloc(8192,'new-'+index):block);
const oldBytes=Buffer.concat(oldBlocks),newBytes=Buffer.concat(newBlocks);
const sha=(bytes:Buffer)=>createHash('sha512').update(bytes).digest('base64');
const blockmap=(blocks:Buffer[])=>gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums:blocks.map(sha),sizes:blocks.map(b=>b.length)}]}));
const assetPath=(version:string)=>new URL(desktopInstallerName(version),desktopReleaseBase(version)).pathname;
const newPath=assetPath(newVersion),oldPath=assetPath(oldVersion);
let directory:string,cache:string,server:http.Server,port:NsisUpdateInstaller;
let requests:{path:string;range?:string;bytes:number}[],logs:string[];
let missingBlockmap:boolean,corruptFull:boolean,corruptRange:boolean,ignoreRange:boolean;

beforeEach(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-differential-'));
  cache=path.join(directory,'cache','cbim-test-cache');
  await fs.mkdir(cache,{recursive:true});await fs.mkdir(path.join(directory,'user'));
  await fs.writeFile(path.join(directory,'app-update.yml'),'updaterCacheDirName: cbim-test-cache\n');
  await fs.writeFile(path.join(cache,'installer.exe'),oldBytes);
  requests=[];logs=[];missingBlockmap=false;corruptFull=false;corruptRange=false;ignoreRange=false;
  server=http.createServer((req,res)=>{
    const pathname=new URL(req.url!,'http://localhost').pathname;
    const entry={path:pathname,range:req.headers.range,bytes:0};requests.push(entry);
    let body:Buffer;
    if(pathname.endsWith('/latest.yml'))body=Buffer.from(JSON.stringify({version:newVersion,files:[{url:desktopInstallerName(newVersion),sha512:sha(newBytes),size:newBytes.length}]}));
    else if(pathname===newPath+'.blockmap'&&!missingBlockmap)body=blockmap(newBlocks);
    else if(pathname===oldPath+'.blockmap')body=blockmap(oldBlocks);
    else if(pathname===newPath){
      const range=req.headers.range;
      if(range&&!ignoreRange){
        const match=/^bytes=(\d+)-(\d+)$/.exec(range);
        if(!match){res.writeHead(416);res.end();return}
        const start=Number(match[1]),end=Number(match[2]);
        body=Buffer.from(newBytes.subarray(start,end+1));if(corruptRange)body[0]^=0xff;
        res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${newBytes.length}`);
      }else{body=Buffer.from(newBytes);if(corruptFull)body[0]^=0xff}
    }else{res.writeHead(404);res.end();return}
    entry.bytes=body.length;res.setHeader('Content-Length',body.length);res.end(body);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('test server address unavailable');
  const httpPort=address.port;
  class LocalExecutor extends ElectronHttpExecutor{
    override createRequest(options:http.RequestOptions,callback:(response:http.IncomingMessage)=>void):Electron.ClientRequest{
      // 保留真实 Provider 生成的固定发布路径，只把传输目标切到当前测试服务。
      expect(options.hostname).toBe('github.com');
      expect(options.headers).not.toHaveProperty('authorization');
      return http.request({...options,protocol:'http:',hostname:'127.0.0.1',port:httpPort,agent:false},callback) as unknown as Electron.ClientRequest;
    }
  }
  state.executor=new LocalExecutor();
  state.app={version:oldVersion,name:'cbim-test',isPackaged:true,appUpdateConfigPath:path.join(directory,'app-update.yml'),userDataPath:path.join(directory,'user'),baseCachePath:path.join(directory,'cache'),whenReady:async()=>{},quit:vi.fn(),relaunch:vi.fn(),onQuit:vi.fn()};
  port=new NsisUpdateInstaller();await port.prepare(release);
  state.updater!.logger={info:value=>logs.push(String(value)),warn:value=>logs.push(String(value)),error:value=>logs.push(String(value))};
});
afterEach(async()=>{
  port?.close();
  if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  // 仅清理本测试创建的系统临时目录，绝不触及真实更新缓存。
  if(directory)await fs.rm(directory,{recursive:true,force:true});
});
const payloadRequests=()=>requests.filter(r=>r.path===newPath);
async function expectValidPackage(){
  expect(await fs.readFile(path.join(cache,'pending',desktopInstallerName(newVersion)))).toEqual(newBytes);
  expect(state.updater!.quitAndInstall).not.toHaveBeenCalled();expect(state.app!.quit).not.toHaveBeenCalled();
}

it('downloads only two changed ranges, resolves the old tag and verifies the entire reconstructed package',async()=>{
  const progress:number[]=[];await port.download(value=>progress.push(value));await expectValidPackage();
  expect(payloadRequests().map(r=>r.range)).toEqual(['bytes=8192-16383','bytes=40960-49151']);
  expect(payloadRequests().reduce((n,r)=>n+r.bytes,0)).toBe(newBytes.length/4);
  expect(requests.some(r=>r.path===oldPath+'.blockmap')).toBe(true);
  expect(progress.length).toBeGreaterThan(0);expect(progress.every(p=>p>=0&&p<=100)).toBe(true);
});

it('revalidates and reuses a staged package after reopening without downloading or installing it',async()=>{
  await port.download(()=>{});port.close();requests=[];
  port=new NsisUpdateInstaller();await port.prepare(release);await port.download(()=>{});
  await expectValidPackage();expect(payloadRequests()).toEqual([]);expect(requests.every(r=>r.path.endsWith('/latest.yml'))).toBe(true);
});

it('uses the cached old blockmap when the old installation has one',async()=>{
  await fs.writeFile(path.join(cache,'current.blockmap'),blockmap(oldBlocks));
  await port.download(()=>{});await expectValidPackage();
  expect(requests.some(r=>r.path===oldPath+'.blockmap')).toBe(false);expect(payloadRequests().every(r=>!!r.range)).toBe(true);
});

it.each(['missing installer','missing blockmap','corrupt old installer','corrupt ranges','no range support'] as const)('falls back to a verified full download for %s',async fault=>{
  if(fault==='missing installer')await fs.unlink(path.join(cache,'installer.exe'));
  if(fault==='missing blockmap')missingBlockmap=true;
  if(fault==='corrupt old installer')await fs.writeFile(path.join(cache,'installer.exe'),Buffer.alloc(oldBytes.length));
  if(fault==='corrupt ranges')corruptRange=true;
  if(fault==='no range support')ignoreRange=true;
  await port.download(()=>{});await expectValidPackage();
  expect(payloadRequests().filter(r=>!r.range)).toEqual([{path:newPath,range:undefined,bytes:newBytes.length}]);
  expect(logs.some(line=>line.includes('fallback to full download'))).toBe(true);
});

it('rejects a corrupt full fallback and never makes it installable',async()=>{
  missingBlockmap=true;corruptFull=true;
  await expect(port.download(()=>{})).rejects.toThrow(/checksum/i);
  expect(()=>port.install()).toThrow('安装包尚未就绪');expect(state.updater!.quitAndInstall).not.toHaveBeenCalled();
});

it('does not trust a corrupted staged package after reopening',async()=>{
  await port.download(()=>{});port.close();
  await fs.writeFile(path.join(cache,'pending',desktopInstallerName(newVersion)),Buffer.alloc(newBytes.length));requests=[];
  port=new NsisUpdateInstaller();await port.prepare(release);await port.download(()=>{});
  await expectValidPackage();expect(payloadRequests().length).toBeGreaterThan(0);
});
