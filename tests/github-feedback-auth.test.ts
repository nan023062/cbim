import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GitHubFeedbackAuth,type GitHubRequest} from '../src/logic/feedback/service';
import type {GitHubFeedbackConfig} from '../src/logic/feedback';
// 授权单元只验证连接状态；真实内核锁由独立平台集成及提交契约覆盖。
vi.mock('../src/core/platform/node/locking',()=>({KernelLock:class {close(){}}}));
const roots:string[]=[],services:GitHubFeedbackAuth[]=[];
const config:GitHubFeedbackConfig={clientId:'testclient_123',owner:'test-owner',repo:'cbim',visibility:'public',autoSubmit:true};
const binding={workspaceId:'workspace-id',rootSessionId:'root-session'};
const token='gho_testOnlyPrivateCredential';
const cipher={available:()=>true,encrypt:(text:string)=>Buffer.from(text).toString('base64'),decrypt:(text:string)=>Buffer.from(text,'base64').toString()};
const signal=()=>new AbortController().signal;

afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0)){if(!path.resolve(root).startsWith(path.join(os.tmpdir(),'cbim-github-auth-')))throw Error('unsafe fixture path');await fs.rm(root,{recursive:true,force:true})}});
async function fixture(options:{secure?:boolean}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-github-auth-'));roots.push(directory);
  let time=100000,tokenState='success';const calls:string[]=[];
  const request:GitHubRequest=async(url,options)=>{
    options.signal.throwIfAborted();calls.push(url);
    if(url.endsWith('/login/device/code'))return {status:200,data:{device_code:'PRIVATE_DEVICE_CODE',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5}};
    if(url.endsWith('/login/oauth/access_token'))return tokenState==='success'?{status:200,data:{access_token:token,token_type:'bearer',scope:'public_repo'}}:{status:200,data:{error:tokenState}};
    expect(options.token).toBe(token);
    if(url.endsWith('/user'))return {status:200,data:{id:12,login:'tester'}};
    if(url.endsWith('/repos/test-owner/cbim'))return {status:200,data:{id:99,full_name:'test-owner/cbim',has_issues:true,archived:false,private:false}};
    throw Error('unexpected endpoint '+url);
  };
  const create=()=>{const auth=new GitHubFeedbackAuth(path.join(directory,'connection.json'),options.secure===false?undefined:cipher,request,()=>time);services.push(auth);return auth};
  const auth=create();
  const login=async()=>{const start=await auth.begin(config);time+=5000;return auth.poll({flowId:start.flow!.id})};
  return {directory,auth,create,login,calls,advance:(ms:number)=>{time+=ms},setToken:(value:string)=>{tokenState=value}};
}

describe('GitHub device authorization',()=>{
it('distinguishes local authorization pending from a saved connection without polling as a side effect',async()=>{
    const f=await fixture(),started=await f.auth.begin(config);
    f.advance(5000);expect(await f.auth.checkConnection()).toEqual({code:'GITHUB_AUTH_PENDING'});
    expect(f.calls).toHaveLength(1);expect(await f.auth.capture(binding.workspaceId)).toBeUndefined();
    await f.auth.poll({flowId:started.flow!.id});expect(await f.auth.checkConnection()).toMatchObject({code:'GITHUB_CONNECTED'});
    await f.auth.disconnect();await f.auth.begin(config);f.advance(900000);
    expect(await f.auth.checkConnection()).toEqual({code:'GITHUB_NOT_CONNECTED'});
    await f.auth.begin(config);await f.auth.cancel();expect(await f.auth.checkConnection()).toEqual({code:'GITHUB_NOT_CONNECTED'});
  });
it('diagnoses local connection and generation without decrypting credentials or requesting GitHub',async()=>{
    const f=await fixture();expect(await f.auth.checkConnection()).toEqual({code:'GITHUB_NOT_CONNECTED'});expect(f.calls).toHaveLength(0);
    await f.login();const scope=(await f.auth.capture(binding.workspaceId))!,calls=f.calls.length,decrypt=vi.spyOn(cipher,'decrypt');
    expect(await f.auth.checkConnection(scope)).toEqual({code:'GITHUB_CONNECTED',repository:{owner:'test-owner',repo:'cbim'}});
    expect(f.calls).toHaveLength(calls);expect(decrypt).not.toHaveBeenCalled();
    await f.auth.disconnect();expect(await f.auth.checkConnection(scope)).toEqual({code:'GITHUB_NOT_CONNECTED'});
    await f.login();expect(await f.auth.checkConnection(scope)).toMatchObject({code:'GITHUB_CONNECTION_CHANGED'});
    const available=vi.spyOn(cipher,'available').mockReturnValue(false);expect(await f.auth.checkConnection()).toMatchObject({code:'GITHUB_SECRET_STORAGE'});available.mockRestore();
    const file=path.join(f.directory,'connection.json'),data=JSON.parse(await fs.readFile(file,'utf8'));data.connection.expiresAt=1;await fs.writeFile(file,JSON.stringify(data));
    expect(await f.auth.checkConnection()).toMatchObject({code:'GITHUB_EXPIRED'});
    await fs.writeFile(file,'broken private settings');expect(await f.auth.checkConnection()).toEqual({code:'GITHUB_SETTINGS'});
  });
it('requires safe storage before any network request',async()=>{const f=await fixture({secure:false});await expect(f.auth.begin(config)).rejects.toMatchObject({code:'GITHUB_SECRET_STORAGE'});expect(f.calls).toHaveLength(0)});
it('keeps token/device code private and saves only encrypted credential',async()=>{
    const f=await fixture(),started=await f.auth.begin(config);expect(JSON.stringify(started)).not.toContain('PRIVATE_DEVICE_CODE');expect(started.flow?.userCode).toBe('ABCD-EFGH');
    f.advance(5000);const status=await f.auth.poll({flowId:started.flow!.id});expect(status.connected).toEqual({login:'tester',owner:'test-owner',repo:'cbim'});expect(JSON.stringify(status)).not.toContain(token);
    const disk=await fs.readFile(path.join(f.directory,'connection.json'),'utf8');expect(disk).not.toContain(token);expect(disk).not.toContain('PRIVATE_DEVICE_CODE');expect(disk).toContain(cipher.encrypt(token));
  });
it('enforces interval, slow_down and expiry without background polling',async()=>{
    const f=await fixture(),start=await f.auth.begin(config),args={flowId:start.flow!.id};await f.auth.poll(args);expect(f.calls).toHaveLength(1);
    f.setToken('slow_down');f.advance(5000);const slow=await f.auth.poll(args);expect(slow.flow!.nextPollAt).toBe(115000);await f.auth.poll(args);expect(f.calls).toHaveLength(2);
    f.setToken('authorization_pending');f.advance(10000);await f.auth.poll(args);expect(f.calls).toHaveLength(3);
    f.advance(900000);await expect(f.auth.poll(args)).rejects.toMatchObject({code:'GITHUB_EXPIRED'});expect((await f.auth.status()).flow).toBeUndefined();
  });
it('cancels a flow and rejects late polls and invalid authorization',async()=>{
    const f=await fixture(),start=await f.auth.begin(config);await f.auth.cancel();f.advance(5000);await expect(f.auth.poll({flowId:start.flow!.id})).rejects.toMatchObject({code:'GITHUB_FLOW'});
    const next=await f.auth.begin(config);f.setToken('access_denied');f.advance(5000);await expect(f.auth.poll({flowId:next.flow!.id})).rejects.toMatchObject({code:'GITHUB_AUTH'});expect((await f.auth.status()).connected).toBeUndefined();
  });
it('rejects caller tokens, arbitrary addresses and ungranted automatic submission',async()=>{
    const f=await fixture();for(const input of [{...config,token:'secret'},{...config,owner:'evil/x'},{...config,autoSubmit:false}])await expect(f.auth.begin(input)).rejects.toMatchObject({code:'GITHUB_CONFIG'});expect(f.calls).toHaveLength(0);
  });
it('does not let a second service change the target of an existing device flow',async()=>{
    const f=await fixture(),first=await f.auth.begin(config),other=f.create();await other.begin({...config,repo:'different'});f.advance(5000);
    await expect(f.auth.poll({flowId:first.flow!.id})).rejects.toMatchObject({code:'GITHUB_FLOW'});expect(f.calls.filter(call=>call.endsWith('/login/oauth/access_token'))).toHaveLength(0);expect((await f.auth.status()).connected).toBeUndefined();
  });
it('a stale poll cannot cancel the new flow, and queued cancellation prevents authorization from starting',async()=>{
    const f=await fixture(),first=await f.auth.begin(config),second=await f.auth.begin(config);await expect(f.auth.poll({flowId:first.flow!.id})).rejects.toMatchObject({code:'GITHUB_FLOW'});expect((await f.auth.status()).flow!.id).toBe(second.flow!.id);
    const count=f.calls.length,start=f.auth.begin(config),cancel=f.auth.cancel();await expect(start).rejects.toMatchObject({code:'GITHUB_CANCELLED'});await cancel;expect(f.calls).toHaveLength(count);
  });
});
