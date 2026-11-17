import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GitHubFeedback} from '../../../../../src/logic/feedback/service/index';
import type {GitHubRequest} from '../../../../../src/logic/feedback/service/index';
import {feedbackIssue,type FeedbackInput,type GitHubFeedbackConfig} from '../../../../../src/logic/feedback/index';

const roots:string[]=[],services:GitHubFeedback[]=[];
const config:GitHubFeedbackConfig={clientId:'testclient_123',owner:'test-owner',repo:'cbim',visibility:'public',autoSubmit:true};
const bug:FeedbackInput={kind:'bug',summary:'无法打开项目',steps:'点击打开',actual:'出现错误',expected:'打开项目',environment:'Windows 11'};
const wish:FeedbackInput={kind:'wish',summary:'批量导出',scenario:'交付时',problem:'逐个导出很慢',expected:'选择多个文件导出',example:'导出三个模型'};
const binding={workspaceId:'workspace-id',rootSessionId:'root-session'};
const token='gho_testOnlyPrivateCredential';
const cipher={Available:()=>true,Encrypt:(text:string)=>Buffer.from(text).toString('base64'),Decrypt:(text:string)=>Buffer.from(text,'base64').toString()};
const signal=()=>new AbortController().signal;
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const service of services.splice(0))await service.Close();for(const root of roots.splice(0)){if(!path.resolve(root).startsWith(path.join(os.tmpdir(),'cbim-github-')))throw Error('unsafe fixture path');await fs.rm(root,{recursive:true,force:true})}});
async function fixture(options:{secure?:boolean}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-github-'));roots.push(directory);
  let time=100000,postStatus=201,tokenState='success',accountId=12,repoId=99,lost=false,corrupt=false;
  const issues:any[]=[],calls:{url:string;method:string;body?:Record<string,unknown>}[]=[];
  let inspectPost:undefined|(()=>Promise<void>);
  const request:GitHubRequest=async(url,options)=>{
    options.signal.throwIfAborted();calls.push({url,method:options.method,body:options.body});
    if(url.endsWith('/login/device/code'))return {status:200,data:{device_code:'PRIVATE_DEVICE_CODE',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:5}};
    if(url.endsWith('/login/oauth/access_token'))return tokenState==='success'?{status:200,data:{access_token:token,token_type:'bearer',scope:config.visibility==='private'?'repo':'public_repo'}}:{status:200,data:{error:tokenState}};
    expect(options.token).toBe(token);
    if(url.endsWith('/user'))return {status:200,data:{id:accountId,login:'tester'}};
    if(url.endsWith('/repos/test-owner/cbim'))return {status:200,data:{id:repoId,full_name:'test-owner/cbim',has_issues:true,archived:false,private:false}};
    if(url.endsWith('/issues')&&options.method==='POST'){
      await inspectPost?.();
      if(postStatus!==201)return {status:postStatus,data:{message:'private remote error'}};
      const number=issues.length+1,issue={...options.body,number,html_url:`https://github.com/test-owner/cbim/issues/${number}`,url:`https://api.github.com/repos/test-owner/cbim/issues/${number}`,user:{id:accountId}};issues.push(issue);
      if(lost)throw Error('response lost '+token);return {status:201,data:corrupt?{}:issue};
    }
    if(url.includes('/issues?'))return {status:200,data:issues};
    throw Error('unexpected endpoint '+url);
  };
  const create=()=>{const service=new GitHubFeedback(directory,options.secure===false?undefined:cipher,request,()=>time);services.push(service);return service};
  const service=create();
  const login=async()=>{const started=await service.auth.Begin(config);time+=5000;return service.auth.Poll({flowId:started.flow!.id})};
  return {directory,service,create,login,request,calls,issues,posts:()=>calls.filter(call=>call.method==='POST'&&call.url.endsWith('/issues')),advance:(ms:number)=>{time+=ms},setToken:(value:string)=>{tokenState=value},setStatus:(value:number)=>{postStatus=value},lose:()=>{lost=true},corrupt:()=>{corrupt=true},account:(value:number)=>{accountId=value},repository:(value:number)=>{repoId=value},inspect:(fn:()=>Promise<void>)=>{inspectPost=fn}};
}

describe('direct issue submission',()=>{
  it('does not prepare a submission port while authorization is pending',async()=>{
    const f=await fixture();await f.service.auth.Begin(config);f.advance(5000);
    expect(await f.service.Prepare(binding,()=>{})).toBeUndefined();expect(f.calls).toHaveLength(1);
  });
  it.each(['bug','wish'] as const)('submits minimal %s once and deduplicates omitted, blank and placeholder fields after restart',async kind=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;
    const input:FeedbackInput={kind,summary:kind==='bug'?'安装后的桌面图标与启动后窗口图标不一致':'希望支持批量导出'},result=await port.Submit(input,signal());
    const body=String(f.posts()[0].body!.body);expect(body).toContain(input.summary);expect(body.match(/用户未提供/g)).toHaveLength(4);expect(body).not.toContain('补充上下文');
    const details=kind==='bug'?{steps:'',actual:' \n ',expected:'用户未提供',environment:'用户未提供'}:{scenario:'',problem:' \n ',expected:'用户未提供',example:'用户未提供'};
    expect(await port.Submit({...input,...details,extra:''},signal())).toEqual(result);
    await f.service.Close();const next=f.create(),nextPort=(await next.Prepare({...binding,rootSessionId:'new-minimal-conversation'},()=>{}))!;
    expect(await nextPort.Submit(input,signal())).toEqual(result);expect(f.posts()).toHaveLength(1);
  });
  it('keeps supplied partial facts and the exact historical complete-body format',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;
    await port.Submit({kind:'bug',summary:'只有已知现象',actual:'窗口图标不一致',environment:'不清楚',extra:'用户自愿分享的说明'},signal());
    const body=String(f.posts()[0].body!.body);expect(body).toContain('## 实际结果\n\n窗口图标不一致');expect(body).toContain('## 环境\n\n不清楚');expect(body).toContain('## 补充上下文\n\n用户自愿分享的说明');expect(body.match(/用户未提供/g)).toHaveLength(2);
    expect(feedbackIssue(bug)).toEqual({title:'[BUG] 无法打开项目',body:'## 问题\n\n无法打开项目\n\n## 复现步骤\n\n点击打开\n\n## 实际结果\n\n出现错误\n\n## 预期结果\n\n打开项目\n\n## 环境\n\nWindows 11'});
    expect(feedbackIssue(wish)).toEqual({title:'[需求] 批量导出',body:'## 需求\n\n批量导出\n\n## 使用场景\n\n交付时\n\n## 当前困难\n\n逐个导出很慢\n\n## 期望能力\n\n选择多个文件导出\n\n## 使用例子\n\n导出三个模型'});
  });
  it('retains unknown for a minimal report and only reconciles the original once',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!,input:FeedbackInput={kind:'bug',summary:'单句反馈丢失回包'};f.lose();
    await expect(port.Submit(input,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});
    await expect(port.Submit({...input,steps:''},signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});
    await expect(port.Submit({...input,actual:'新增事实'},signal())).rejects.toMatchObject({code:'GITHUB_PENDING_OTHER'});
    expect((await port.Receipt(signal())).status).toBe('submitted');expect(f.posts()).toHaveLength(1);
  });
  it.each([bug,wish])('creates $kind from formatted user fields and saves intent before a single POST',async input=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;
    f.inspect(async()=>{const names=await fs.readdir(path.join(f.directory,'submissions'));const disk=JSON.parse(await fs.readFile(path.join(f.directory,'submissions',names[0]),'utf8'));expect(disk.entries[0].status).toBe('sending');expect(JSON.stringify(disk)).not.toContain(input.summary)});
    const result=await port.Submit(input,signal());expect(result).toEqual({status:'submitted',operationId:expect.any(String)});expect(JSON.stringify(result)).not.toMatch(/github.com|issueNumber|token/);expect(f.posts()).toHaveLength(1);expect(f.posts()[0].body!.title).toBe(feedbackIssue(input).title);expect(f.posts()[0].body!.body).toContain(`<!-- cbim-feedback:${result.operationId} -->`);
  });
  it('deduplicates concurrent and later calls with the same content even after restart',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;const [first,second]=await Promise.all([port.Submit(bug,signal()),port.Submit({...bug},signal())]);expect(second).toEqual(first);expect(f.posts()).toHaveLength(1);
    await f.service.Close();const next=f.create(),nextPort=(await next.Prepare({...binding,rootSessionId:'new-conversation'},()=>{}))!;expect(await nextPort.Submit(bug,signal())).toEqual(first);expect(f.posts()).toHaveLength(1);
  });
  it('blocks changed content after lost POST response, survives restart and only reconciles the original',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;f.lose();await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});await expect(port.Submit(wish,signal())).rejects.toMatchObject({code:'GITHUB_PENDING_OTHER'});expect(f.posts()).toHaveLength(1);
    await f.service.Close();const next=f.create(),nextPort=(await next.Prepare({...binding,rootSessionId:'after-hard-interrupt'},()=>{}))!;await expect(nextPort.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});const result=await nextPort.Receipt(signal());expect(result.status).toBe('submitted');expect(await nextPort.Submit(bug,signal())).toEqual(result);expect(f.posts()).toHaveLength(1);
  });
  it.each(['missing','wrong-author','modified-body','wrong-repository','pull-request'])('does not clear unknown based on %s',async mode=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;f.lose();await expect(port.Submit(bug,signal())).rejects.toThrow();
    if(mode==='missing')f.issues.length=0;
    if(mode==='wrong-author')f.issues[0].user.id=999;
    if(mode==='modified-body')f.issues[0].body+=' forged';
    if(mode==='wrong-repository')f.issues[0].html_url='https://github.com/other/cbim/issues/1';
    if(mode==='pull-request')f.issues[0].pull_request={};
    await expect(port.Receipt(signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});await expect(port.Submit(wish,signal())).rejects.toMatchObject({code:'GITHUB_PENDING_OTHER'});expect(f.posts()).toHaveLength(1);
  });
  it('treats malformed 201 and 503 as unknown, never retries POST automatically',async()=>{
    for(const mode of ['corrupt','503']){const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;if(mode==='corrupt')f.corrupt();else f.setStatus(503);await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});expect(f.posts()).toHaveLength(1)}
  });
  it('records definite refusal without claiming success or leaking remote errors',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;f.setStatus(422);await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_REJECTED',message:expect.stringContaining('422')});await expect(port.Receipt(signal())).rejects.toMatchObject({code:'GITHUB_REJECTED'});expect(f.posts()).toHaveLength(1);
  });
  it('checks account/repository identity before POST and refuses a retired workspace',async()=>{
    const f=await fixture();await f.login();let retired=false;const port=(await f.service.Prepare(binding,()=>{if(retired)throw Error('retired')}))!;
    f.account(999);await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_IDENTITY_CHANGED'});f.account(12);f.repository(888);await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_IDENTITY_CHANGED'});retired=true;await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_OPERATION'});expect(f.posts()).toHaveLength(0);
  });
  it('refuses invalid fields, oversized content, corrupt ledger and pre-cancelled calls before POST',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;
    await expect(port.Submit({...bug,repo:'evil'} as any,signal())).rejects.toMatchObject({code:'GITHUB_FEEDBACK_INPUT'});
    await expect(port.Submit({...bug,steps:'字'.repeat(6000),actual:'字'.repeat(6000),expected:'字'.repeat(6000)},signal())).rejects.toMatchObject({code:'GITHUB_FEEDBACK_SIZE'});
    const cancelled=new AbortController();cancelled.abort();await expect(port.Submit(bug,cancelled.signal)).rejects.toThrow();
    const submissions=path.join(f.directory,'submissions');await fs.writeFile(submissions,'not a directory');await expect(port.Submit(bug,signal())).rejects.toThrow();expect(f.posts()).toHaveLength(0);
  });
  it('keeps the durable sending barrier when saving a valid POST receipt fails',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;
    f.inspect(async()=>{vi.spyOn(fs,'rename').mockRejectedValueOnce(Error('simulated disk failure'))});
    await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});expect(f.posts()).toHaveLength(1);vi.restoreAllMocks();
    await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_SUBMISSION_UNKNOWN'});expect((await port.Receipt(signal())).status).toBe('submitted');expect(f.posts()).toHaveLength(1);
  });
  it('retains unknown after disconnect/reconnect and refuses reconciliation under a different account',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;f.lose();await expect(port.Submit(bug,signal())).rejects.toThrow();await f.service.auth.Disconnect();f.account(99);await f.login();const next=(await f.service.Prepare(binding,()=>{}))!;
    await expect(next.Submit(wish,signal())).rejects.toMatchObject({code:'GITHUB_PENDING_OTHER'});await expect(next.Receipt(signal())).rejects.toMatchObject({code:'GITHUB_RECEIPT_TARGET'});expect(f.posts()).toHaveLength(1);
  });
it('disconnects without returning credentials and invalidates captured ports',async()=>{
    const f=await fixture();await f.login();const port=(await f.service.Prepare(binding,()=>{}))!;await f.service.auth.Disconnect();await expect(port.Submit(bug,signal())).rejects.toMatchObject({code:'GITHUB_CONNECTION_CHANGED'});expect(f.posts()).toHaveLength(0);expect(await f.service.Prepare(binding,()=>{})).toBeUndefined();
  });
});
