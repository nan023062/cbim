// 真实 React 设置组件与隔离 IPC 夹具；不访问生产配置、下载通道或模型服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'engine-settings-ui.html'),'<div id="root"></div><script type="module" src="/test-results/engine-settings-ui.tsx"></script>');
await fs.writeFile(path.join(out,'engine-settings-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/view/shell/shell.css';
const artifact=(kind,id,version)=>({kind,identity:id.repeat(64),version,nativeVersion:'1.5.0',protocol:1,dependencies:[]});
window.fixture={calls:[],state:{managed:true,revision:3,items:[{kind:'pi',enabled:true,active:artifact('pi','a','1.0.0'),candidate:artifact('pi','b','1.1.0'),installed:[artifact('pi','a','1.0.0')],references:0,preparing:false}]}};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='models.list')return {secureStorage:true,profiles:[{id:'provider',name:'测试供应商',api:'openai-completions',baseUrl:'http://localhost:12345/v1',defaultModel:'model',models:[{id:'model',name:'可用生成模型',enabled:true,contextWindow:32768,maxTokens:4096}]}]};
 if(action==='engines.settings')return structuredClone(f.state);
 if(action==='engines.check')return structuredClone(f.state);
 if(action==='engines.install'){if(args.revision!==3||args.identity!=='b'.repeat(64))throw Error('错误候选');f.state.revision++;f.state.items[0].active=f.state.items[0].candidate;return structuredClone(f.state)}
 if(action==='engines.configure'){if(args.action==='remove')throw Error('仍被启用的 Codex 引擎依赖，请先停用它');f.state.revision++;f.state.items[0].enabled=args.action==='enable';return structuredClone(f.state)}
 throw Error('Unexpected IPC '+action);
}};
const {EngineSettings}=await import('/src/view/settings/EngineSettings.tsx');createRoot(document.getElementById('root')).render(<EngineSettings/>);
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/engine-settings-ui.html');await page.getByText('当前可用模型：测试供应商 / 可用生成模型',{exact:true}).first().waitFor();
  const pi=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Pi',exact:true})});await pi.getByRole('button',{name:'更新引擎',exact:true}).click();await page.getByText('引擎已准备并启用；正在运行的任务保持原版本。',{exact:true}).waitFor();
  await pi.getByRole('button',{name:'停用',exact:true}).click();await pi.getByRole('button',{name:'启用',exact:true}).waitFor();await pi.getByRole('button',{name:'移除引擎',exact:true}).click();await page.getByRole('alert').filter({hasText:'仍被启用的 Codex'}).waitFor();
  const calls=await page.evaluate(()=>window.fixture.calls);assert.equal(calls.filter(call=>call.action==='engines.install').length,1);assert.equal(calls.find(call=>call.action==='engines.install').args.identity,'b'.repeat(64));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:['显示业务与可用模型','提交准确候选及 revision','停用后可启用','依赖移除失败保留状态'],pageErrors:errors}));
}finally{await browser?.close();await server.close()}
