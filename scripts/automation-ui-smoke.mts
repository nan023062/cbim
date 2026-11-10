// Exact packaged executable, isolated user directory and deterministic local provider.
// UI clicks perform configuration and start; IPC is limited to setup and factual observations.
import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {latestExecutable} from './build-artifact.mjs';
import {moduleFiles,request} from '../tests/knowledge-data';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-automation-ui-')),user=path.join(temp,'user'),project=path.join(temp,'automation-project');
await fs.mkdir(project);await fs.mkdir(user);await fs.mkdir('test-results',{recursive:true});
const report=process.env.CBIM_AUTOMATION_UI_REPORT??'test-results/automation-ui-smoke.json';
await assert.rejects(fs.access(report),'A report already exists; preserve it and choose a new path');
let desktop:ElectronApplication|undefined,page:Page|undefined,step='start';const errors:string[]=[],completed:string[]=[],calls:string[]=[];
const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(body.model);res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [delta,finish_reason] of [[{role:'assistant',content:'自动化界面验证：执行已结束，未进行业务验收。'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'ui-'+calls.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('provider listen failed');
try{
 const exe=await latestExecutable();desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
 assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
 page=await desktop.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1400,height:950});
 await page.waitForFunction(()=>!!(window as any).cbim);const call=(action:string,args:unknown={})=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
 const entry=await call('add',{path:project}),identity={workspaceId:entry.id,instanceId:(await call('snapshot',{id:entry.id})).instanceId};
 const profile=await call('models.save',{profile:{name:'UI local model',api:'openai-completions',baseUrl:'http://127.0.0.1:'+address.port+'/v1',auth:'none',defaultModel:'automation-ui',models:[{id:'automation-ui',name:'自动化验证模型',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,vision:false}]}});
 const main=await call('agent.mainSettings',identity);await call('agent.configureMain',{...main,selection:{engine:'pi',profileId:profile.profiles[0].id,modelId:'automation-ui'}});
 const snapshot=await call('snapshot',{id:entry.id}),changes=moduleFiles('review').map(({path,text})=>({path,text}));const preview=await call('preview',request(snapshot,changes));assert.equal(preview.validation.structural,true);await call('commit',preview.request);
 await page.getByRole('button',{name:'automation-project · 运行中',exact:true}).click();assert.equal(await page.title(),'CBIM');
 step='engine menu';await page.getByRole('combobox',{name:'Loop 引擎',exact:true}).click();for(const name of ['Pi','Claude Code','Codex'])await page.getByRole('option',{name,exact:true}).waitFor();await page.keyboard.press('Escape');completed.push('三个执行引擎始终可见；窗口标题 CBIM');
 step='automation form';const draft=page.locator('.chat-input');if(await draft.count())await draft.fill('未发送的原对话草稿');
 await page.getByRole('tab',{name:'自动化',exact:true}).click();const view=page.locator('.workspace-automation:visible');await view.getByRole('button',{name:'新建自动化',exact:true}).click();
 await view.getByLabel('任务名称',{exact:true}).fill('界面自动化');await view.getByLabel('提示上下文',{exact:true}).fill('只读报告当前模块状态。');await view.getByRole('checkbox',{name:/review/}).check();await view.getByRole('checkbox',{name:'知识查询',exact:true}).check();await view.getByRole('button',{name:'保存任务',exact:true}).click();await view.getByRole('heading',{name:'界面自动化',exact:true}).waitFor();
 let state=await call('automation.list',identity);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].definition.permission,'read');assert.deepEqual(state.jobs[0].definition.moduleIds,['.cbim/workspace/review']);assert.equal(calls.length,0);completed.push('实际表单保存 Agent/模块/Skill/提示与权限，保存不启动');
 step='run';await view.getByRole('button',{name:'立即运行',exact:true}).click();await view.getByRole('button',{name:'打开对应会话',exact:true}).first().waitFor();state=await call('automation.list',identity);const run=state.runs[0];assert.ok(run.taskId&&run.runId);
 await page.waitForFunction(async(identity)=>(await (window as any).cbim.call('automation.list',identity)).runs[0]?.status==='completed',identity,{timeout:40000});assert.equal(calls.length,1);
 await view.getByRole('button',{name:'打开对应会话',exact:true}).first().click();await page.getByRole('tab',{name:'对话',exact:true}).waitFor();completed.push('真实 Pi 运行一次，记录指向原会话');
 step='file preview';const open=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await open.isVisible())await open.click();let tab=page.getByRole('tab',{name:'业务架构',exact:true});if(await tab.count())await tab.click();else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await page.getByRole('button',{name:'打开业务架构',exact:true}).click()}
 await page.locator('[data-knowledge-path=".cbim/workspace/review/module.json"]:visible').click();await page.getByRole('button',{name:'编辑文件',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑知识文件',exact:true}),editor=dialog.getByLabel('知识文件正文');const original=await editor.inputValue();await editor.fill('{');await dialog.getByText('结构校验未通过',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'提交已校验修改',exact:true}).isEnabled(),false);await editor.fill(original);await dialog.getByText('结构校验通过',{exact:true}).waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();completed.push('业务文件树可预览，编辑自动校验阻止坏 JSON');
 await page.screenshot({path:report.replace(/\.json$/,'.png')});assert.deepEqual(errors,[]);await fs.writeFile(report,JSON.stringify({success:true,packagedExe:exe,temporaryFixture:temp,completed,calls,errors,taskId:run.taskId,runId:run.runId},null,2));console.log(JSON.stringify({success:true,completed,report}));
}catch(error){await page?.screenshot({path:report.replace(/\.json$/,'-failed.png')}).catch(()=>{});await fs.writeFile(report,JSON.stringify({success:false,step,completed,errors,calls,error:String(error),temporaryFixture:temp},null,2));throw error}
finally{await desktop?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
