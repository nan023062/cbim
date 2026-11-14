// 隔离真实表单验证：向量配置不丢失，模型测试无引擎参数，不调用生产模型。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'model-capabilities-ui.html'),'<div id="root"></div><script type="module" src="/test-results/model-capabilities-ui.tsx"></script>');
await fs.writeFile(path.join(out,'model-capabilities-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import {definition} from '/src/bridge/contracts/models.ts';import '/src/view/shell/shell.css';
const profile={id:'11111111-1111-4111-8111-111111111111',name:'向量供应商',api:'openai-completions',baseUrl:'http://localhost:12345/v1',auth:'none',hasKey:false,defaultModel:'',models:[],embedding:{api:'openai-embeddings',baseUrl:'http://localhost:12345/v1',models:[{id:'vector-model',name:'向量模型',enabled:true,inputTokens:8192,dimensions:3}]}};
window.fixture={calls:[],settings:{secureStorage:true,profiles:[profile]}};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});if(action==='models.list')return structuredClone(f.settings);if(action==='models.save'){definition.parse(args.profile);f.settings.profiles=[{...args.profile,id:args.id,hasKey:false}];return structuredClone(f.settings)}if(action==='models.testConnection')return {ok:true,model:args.modelId,latencyMs:1,api:'openai-embeddings',baseUrl:profile.embedding.baseUrl,dimensions:3};throw Error('Unexpected IPC '+action)}};
const {ModelSettings}=await import('/src/view/settings/ModelSettings.tsx');createRoot(document.getElementById('root')).render(<ModelSettings/>);
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:900,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/model-capabilities-ui.html');await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('spinbutton',{name:'向量维度',exact:true}).fill('4');await page.getByRole('button',{name:'保存供应商',exact:true}).click();await page.getByText('供应商已保存。新启动的任务使用新配置，可点击测试连接验证。',{exact:true}).waitFor();
  const save=await page.evaluate(()=>window.fixture.calls.find(call=>call.action==='models.save').args);assert.equal(save.profile.models.length,0);assert.equal(save.profile.embedding.models[0].dimensions,4);assert.equal(save.profile.defaultModel,'');assert.ok(!('maxTokens' in save.profile.embedding.models[0]));
  await page.getByRole('button',{name:'测试连接',exact:true}).click();await page.getByText(/连接成功.*向量维度 3/).waitFor();const request=await page.evaluate(()=>window.fixture.calls.find(call=>call.action==='models.testConnection').args);assert.equal(request.kind,'embedding');assert.equal(request.modelId,'vector-model');assert.ok(!('engine' in request));assert.equal(await page.getByText('测试引擎',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:['编辑保留向量配置','向量单独容量与维度','纯向量供应商可保存','按操作测试不提交引擎'],pageErrors:errors}));
}finally{await browser?.close();await server.close()}
