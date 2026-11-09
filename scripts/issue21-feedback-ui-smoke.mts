import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
import {knowledgeContractResult} from '../tests/knowledge-contract-provider';

// Real portable Electron/IPC/Pi; only model replies and GitHub HTTP are fixtures.
// Never connects a real account, creates an online Issue or touches an installed client.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-issue21-')),user=path.join(temp,'user'),project=path.join(temp,'issue21-project');
const requests:any[]=[],errors:string[]=[],checks:string[]=[];let desktop:ElectronApplication|undefined,page:Page|undefined,identity:{workspaceId:string;instanceId:string};
const descriptions=['安装后的桌面图标与启动后窗口图标不一致','希望支持批量导出'];
const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);const phase=turn%4,kind=turn<4?'bug':'wish',skill=kind==='bug'?'cbim_skill_bug_feedback':'cbim_skill_feature_wish';
  assert.ok(turn<8);assert.ok(!raw.includes('issue21_fixture_token'));assert.ok(body.tools.some((tool:any)=>tool.function.name==='cbim_feedback_submit'));
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'issue21-'+turn,object:'chat.completion.chunk',created:1,model:'feedback-fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  if(phase===0){assert.ok(raw.includes('一句话描述问题或愿望即可'));assert.ok(raw.includes('其余信息自愿补充，不强制追问'));tool('skill-'+kind,skill,identity)}
  if(phase===1){const result=knowledgeContractResult(body,'skill-'+kind);assert.equal(typeof result.text,'string',JSON.stringify(result));assert.ok(result.text.includes('只填写第一项就可以提交'));assert.ok(result.text.includes('不要为填满字段反复追问'));emit({role:'assistant',content:kind==='bug'?'用一句话描述遇到的问题即可，其余信息都可不填。':'用一句话描述想要的功能即可，其余信息都可不填。'});emit({},'stop')}
  if(phase===2)tool('submit-'+kind,'cbim_feedback_submit',{kind,summary:descriptions[kind==='bug'?0:1]});
  if(phase===3){assert.equal(knowledgeContractResult(body,'submit-'+kind).status,'submitted');emit({role:'assistant',content:'ISSUE21_SUCCESS_MUST_STAY_HIDDEN'});emit({},'stop')}
  res.end('data: [DONE]\n\n');
}catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture error')}});
const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+30000;while(Date.now()<end){assert.deepEqual(errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('等待超时：'+label)};
try{
  await fs.mkdir(project);await fs.mkdir('test-results',{recursive:true});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const executable=await latestExecutable();assert.ok(path.resolve(executable).startsWith(path.resolve('build')+path.sep));
  desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'用户菜单',exact:true}).waitFor();
  // tsx keepNames helpers are otherwise absent when Playwright serializes nested fixture functions.
  await desktop.evaluate('globalThis.__name = fn => fn');
  await desktop.evaluate(()=>{
    const realFetch=globalThis.fetch,issues:any[]=[];(globalThis as any).__issue21Issues=issues;
    globalThis.fetch=(async(url:any,options:any)=>{const target=String(url);if(!target.startsWith('https://github.com/')&&!target.startsWith('https://api.github.com/'))return realFetch(url,options);
      const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      if(target.endsWith('/login/device/code'))return reply({device_code:'fixture-device-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:1});
      if(target.endsWith('/login/oauth/access_token'))return reply({access_token:'issue21_fixture_token',token_type:'bearer',scope:'public_repo'});
      if(target.endsWith('/user'))return reply({id:21,login:'fixture-user'});
      if(target.endsWith('/repos/fixture-owner/fixture-repo'))return reply({id:21,full_name:'fixture-owner/fixture-repo',has_issues:true,archived:false,private:false});
      if(target.endsWith('/issues')&&options?.method==='POST'){const body=JSON.parse(String(options.body)),number=issues.length+1,issue={...body,number,html_url:'https://github.com/fixture-owner/fixture-repo/issues/'+number,url:'https://api.github.com/repos/fixture-owner/fixture-repo/issues/'+number,user:{id:21}};issues.push(issue);return reply(issue,201)}
      throw Error('Unexpected fixture GitHub endpoint '+target);
    }) as typeof fetch;
  });
  const call=(action:string,args:unknown={})=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const entry=await call('add',{path:project}),opened=await call('open',{id:entry.id});identity={workspaceId:entry.id,instanceId:opened.instanceId};assert.equal(typeof identity.instanceId,'string');const before=await call('snapshot',{id:entry.id});
  const login=await call('github.feedback.begin',{clientId:'fixture_client',owner:'fixture-owner',repo:'fixture-repo',visibility:'public',autoSubmit:true});await until(async()=>!!(await call('github.feedback.poll',{flowId:login.flow.id})).connected,'fixture authorization saved');
  await call('models.save',{profile:{name:'Issue21 fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'feedback-fixture',models:[{id:'feedback-fixture',name:'Issue21 fixture',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  await page.reload();
  await page.getByRole('button',{name:'issue21-project · 运行中',exact:true}).click();const input=page.getByRole('textbox',{name:'对话草稿',exact:true});let taskId='';
  const settled=async()=>{const list=await call('loop.list',{id:entry.id});if(!list.length)return false;taskId=list[0].task.taskId;const view=await call('loop.threadView',{id:entry.id,taskId});return view.runs.at(-1)?.status==='completed'};
  for(const [index,title] of ['BUG 反馈','需求许愿'].entries()){
    const draft='未发送的普通草稿 '+index;await input.fill(draft);await page.locator('summary[aria-label="添加上下文"]').click();await page.getByRole('button',{name:title,exact:true}).click();
    await until(async()=>requests.length===index*4+2&&await settled(),title+' menu guidance');assert.equal(await input.inputValue(),draft);assert.equal(await desktop.evaluate(()=>(globalThis as any).__issue21Issues.length),index);checks.push(title+'-menu-preserves-draft-and-only-reads-skill');
    await input.fill(descriptions[index]);await input.press('Enter');await until(async()=>requests.length===(index+1)*4&&await settled(),title+' one-line submit');
    await page.locator('.chat-turn').nth(index*2+1).locator('.work-outcome').filter({hasText:'本轮结束'}).waitFor();
    const issues=await desktop.evaluate(()=>(globalThis as any).__issue21Issues);assert.equal(issues.length,index+1);assert.ok(issues[index].body.includes(descriptions[index]));assert.equal(issues[index].body.match(/用户未提供/g)?.length,4);
    assert.equal(await input.inputValue(),'');assert.equal(await page.getByText('ISSUE21_SUCCESS_MUST_STAY_HIDDEN',{exact:true}).count(),0);assert.deepEqual(await call('loop.questions',{id:entry.id,taskId}),[]);assert.deepEqual(await call('loop.approvals',{id:entry.id,taskId}),[]);checks.push(title+'-one-line-submit-without-questions-and-silent-success');
  }
  const view=await call('loop.threadView',{id:entry.id,taskId});assert.equal(view.runs.flatMap((run:any)=>run.toolReceipts??[]).filter((receipt:any)=>receipt.toolName==='cbim_feedback_submit'&&receipt.outcome==='succeeded').length,2);
  assert.equal((await call('snapshot',{id:entry.id})).revision,before.revision);assert.deepEqual((await call('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:taskId}})).tasks,[]);
  await input.fill('重载保留的草稿');await page.screenshot({path:'test-results/issue21-feedback-ui.png'});await page.reload();await page.getByRole('button',{name:'issue21-project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:'请调用'}).first().click();await input.waitFor();assert.equal(await input.inputValue(),'重载保留的草稿');assert.equal(await desktop.evaluate(()=>(globalThis as any).__issue21Issues.length),2);assert.equal(requests.length,8);assert.equal(await page.getByText('ISSUE21_SUCCESS_MUST_STAY_HIDDEN',{exact:true}).count(),0);assert.deepEqual(errors,[]);checks.push('reload-retains-draft-and-receipts-without-replay-or-business-work');
  const report={executable,checks,pageErrors:errors,modelRequests:requests.length,fixtureIssues:2,onlineIssues:0,source:'real packaged Electron/IPC/Pi; deterministic local SSE and main-process GitHub HTTP fixtures'};await fs.writeFile('test-results/issue21-feedback-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem='test-results/issue21-feedback-failure-'+Date.now();await fs.mkdir('test-results',{recursive:true});await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,requests:requests.length,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}
finally{await desktop?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-issue21-'));await fs.rm(target,{recursive:true,force:true})}
