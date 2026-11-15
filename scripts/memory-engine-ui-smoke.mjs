// 真实 React 角色表单与隔离 IPC；验证记忆双模型筛选及共用主 Agent 保存，不访问用户账号或模型。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'memory-engine-ui.html'),'<div id="root"></div><script type="module" src="/test-results/memory-engine-ui.tsx"></script>');
await fs.writeFile(path.join(out,'memory-engine-ui.tsx'),String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/view/shell/shell.css';
const profileId='11111111-1111-4111-8111-111111111111';
const models={secureStorage:true,profiles:[{id:profileId,name:'测试供应商',api:'openai-completions',baseUrl:'http://localhost:12345/v1',auth:'none',hasKey:false,defaultModel:'chat',models:[{id:'chat',name:'生成模型',enabled:true,contextWindow:8192,maxTokens:1024,reasoning:false}],embedding:{api:'openai-embeddings',baseUrl:'http://localhost:12345/v1',models:[{id:'vector',name:'向量模型',enabled:true,inputTokens:8192,dimensions:2},{id:'disabled',name:'禁用向量',enabled:false,inputTokens:8192,dimensions:2}]}}]};
window.fixture={calls:[],value:{workspaceId:'a'.repeat(64),instanceId:'22222222-2222-4222-8222-222222222222',agentId:'cbim:main',revision:3,selection:{engine:'pi',profileId,modelId:'chat'}}};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});if(action==='agent.mainSettings')return structuredClone(f.value);if(action==='models.list')return structuredClone(models);if(action==='engines.settings')return {managed:false,revision:0,items:[]};if(action==='agent.configureMain'){if(args.revision!==f.value.revision)throw Error('主 Agent 配置已变化，请重新读取后保存');f.value={...args,revision:args.revision+1};return structuredClone(f.value)}throw Error('Unexpected '+action)}};
const {AgentModelForm}=await import('/src/view/components/AgentModelForm.tsx'),{useMainAgentSettings}=await import('/src/view/team/useMainAgentSettings.ts'),{EngineSettings}=await import('/src/view/settings/EngineSettings.tsx');
function App(){const main=useMainAgentSettings('a'.repeat(64),'22222222-2222-4222-8222-222222222222'),[editing,setEditing]=useState();return <><p role="status">已读版本 {main.value?.revision}</p><button disabled={!main.value||!!editing} onClick={()=>setEditing({initial:main.value.selection,revision:main.value.revision})}>编辑主 Agent</button>{editing&&<AgentModelForm models={models} initial={editing.initial} busy={main.busy} onCancel={()=>setEditing(undefined)} onSave={async value=>{if(await main.save(value,editing.revision))setEditing(undefined)}}/>}{main.error&&<p role="alert">{main.error}</p>}<EngineSettings/></>};createRoot(document.getElementById('root')).render(<App/>);
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:375,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/memory-engine-ui.html');await page.getByRole('button',{name:'编辑主 Agent',exact:true}).click();
  await page.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('memory');
  const generation=page.getByRole('combobox',{name:'Agent 生成模型',exact:true});
  // 默认 label 在组件中为 Agent 模型，按实际属性读取，避免对产品添加测试专用标识。
  const primary=await generation.count()?generation:page.getByRole('combobox',{name:'Agent 模型',exact:true});
  await primary.selectOption(JSON.stringify(['11111111-1111-4111-8111-111111111111','chat']));
  const save=page.getByRole('button',{name:'保存主 Agent 配置',exact:true});assert.equal(await save.isDisabled(),true);
  const vector=page.getByRole('combobox',{name:'Agent 记忆向量模型',exact:true});assert.equal(await vector.locator('option').count(),2);await vector.selectOption(JSON.stringify(['11111111-1111-4111-8111-111111111111','vector']));assert.equal(await save.isDisabled(),false);
  await save.click();await page.getByText('已读版本 4',{exact:true}).waitFor();const request=await page.evaluate(()=>window.fixture.calls.find(call=>call.action==='agent.configureMain').args);assert.equal(request.selection.engine,'memory');assert.equal(request.selection.modelRoles.roles.embedding.kind,'embedding');assert.equal(request.selection.modelId,'chat');assert.equal(request.selection.modelRoles.roles.embedding.modelId,'vector');
  await page.getByRole('button',{name:'编辑主 Agent',exact:true}).click();await page.evaluate(()=>{window.fixture.value.revision=5});await page.getByText('已读版本 5',{exact:true}).waitFor();await page.getByRole('button',{name:'保存主 Agent 配置',exact:true}).click();await page.getByRole('alert').filter({hasText:'主 Agent 配置已变化'}).waitFor();assert.equal(await vector.inputValue(),JSON.stringify(['11111111-1111-4111-8111-111111111111','vector']));
  const memory=page.locator('article').filter({has:page.getByRole('heading',{name:'记忆引擎',exact:true})});assert.match(await memory.innerText(),/当前可用：测试供应商 \/ 向量模型/);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'memory-engine-ui.png'),fullPage:true});
  console.log(JSON.stringify({checks:['记忆引擎必填双模型','禁用向量不进入选项','主 Agent 一次保存完整角色','并发版本变化拒绝旧草稿且保留选择','能力列表展示可用向量模型'],pageErrors:errors}));
}finally{await browser?.close();await server.close()}
