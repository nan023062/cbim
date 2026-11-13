// 真实设置组件与模型选择器，确定性 IPC 夹具；不读取用户 Key、不调用外部模型服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'provider-connections-ui.html'),'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/test-results/provider-connections-ui.tsx"></script>');
await fs.writeFile(path.join(out,'provider-connections-ui.tsx'),String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '/src/view/shell/shell.css';
import {definition} from '/src/logic/models/index.ts';
import {connectionForEngine} from '/src/logic/models/index.ts';
import {EngineModelPicker} from '/src/view/components/EngineModelPicker.tsx';
const id='11111111-1111-4111-8111-111111111111';
window.fixture={calls:[],failTest:false,state:{selectedId:id,secureStorage:true,profiles:[{id,name:'DeepSeek',api:'openai-completions',baseUrl:'https://api.deepseek.com/v1',auth:'api-key',hasKey:true,defaultModel:'deepseek-flash',models:[{id:'deepseek-flash',name:'Flash',enabled:true,reasoning:true,contextWindow:1048576,maxTokens:4096}]}]}};
window.cbim={call:async(action,args)=>{
  const f=window.fixture;f.calls.push({action,args});
  if(action==='models.list')return structuredClone(f.state);
  if(action==='models.save'){
    const profile=definition.parse(args.profile),next={...profile,id:args.id??'22222222-2222-4222-8222-222222222222',hasKey:true};
    f.state.profiles=args.id?f.state.profiles.map(old=>old.id===args.id?next:old):[...f.state.profiles,next];
    f.refresh();return structuredClone(f.state);
  }
  if(action==='models.test'){
    if(f.failTest)throw Error('测试接口返回 HTTP 401：鉴权失败');
    const profile=f.state.profiles.find(p=>p.id===args.id),connection=connectionForEngine(profile,args.engine??'pi',args.modelId??profile.defaultModel);
    if(!connection)throw Error('没有兼容接口');
    return {ok:true,model:args.modelId??profile.defaultModel,engine:args.engine??'pi',api:connection.api,baseUrl:connection.baseUrl,latencyMs:1};
  }
  throw Error('Unexpected IPC '+action);
}};
const {ModelSettings}=await import('/src/view/settings/ModelSettings.tsx');
function App(){
  const [models,setModels]=useState(structuredClone(window.fixture.state)),[selection,setSelection]=useState(null);
  window.fixture.refresh=()=>setModels(structuredClone(window.fixture.state));
  return <main style={{maxWidth:800,padding:16,margin:'0 auto',minWidth:0}}><ModelSettings/><section aria-label="测试 Agent 选型"><EngineModelPicker models={models} value={selection} initialEngine="pi" onChange={setSelection}/></section></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser,page;const errors=[],checks=[];
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});
  page=await browser.newPage({viewport:{width:1100,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/provider-connections-ui.html');
  await page.getByRole('button',{name:'编辑',exact:true}).waitFor();
  const picker=page.getByRole('region',{name:'测试 Agent 选型'});
  for(const engine of ['claude-code','codex','pi']){
    await picker.getByLabel('Agent Loop 引擎').selectOption(engine);
    assert.match(await picker.getByLabel('Agent 模型').innerText(),/DeepSeek \/ Flash/);
  }
  assert.equal((await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='models.test').length)),0);
  checks.push('legacy-provider-selects-three-engines-without-probes');
  await page.getByLabel('DeepSeek 测试引擎').selectOption('claude-code');
  await page.getByRole('button',{name:'测试连接',exact:true}).click();
  await page.getByRole('status').getByText(/Anthropic Messages，仅文本请求/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='models.test').args),{id:'11111111-1111-4111-8111-111111111111',modelId:'deepseek-flash',engine:'claude-code'});
  checks.push('explicit-test-shows-selected-engine-and-endpoint');
  await page.evaluate(()=>{window.fixture.failTest=true});
  await page.getByRole('button',{name:'测试连接',exact:true}).click();await page.getByRole('alert').getByText(/HTTP 401/).waitFor();
  assert.equal(await page.locator('.model-provider').count(),1);await page.evaluate(()=>{window.fixture.failTest=false});
  checks.push('failed-test-keeps-provider-and-model');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('按官方地址自动适配引擎，共用此供应商的 API Key').uncheck();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.state.profiles[0].autoDetect),undefined);
  checks.push('cancel-discards-connection-draft');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByText('高级：自定义兼容接口',{exact:true}).click();
  await page.getByRole('button',{name:'添加 Anthropic Messages 接口',exact:true}).click();
  await page.getByLabel('Anthropic Messages 地址',{exact:true}).fill('https://gateway.example/anthropic');
  await page.getByLabel('仅允许指定型号（不勾选时共用全部型号）').check();
  await page.getByLabel('API Key',{exact:true}).fill('fixture-key-only');
  await page.getByRole('button',{name:'保存供应商',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.fixture.state.profiles[0]);
  assert.deepEqual(saved.alternateConnections,[{api:'anthropic-messages',baseUrl:'https://gateway.example/anthropic',modelIds:['deepseek-flash']}]);
  assert.equal(await page.locator('.model-provider').count(),1);
  checks.push('custom-interface-and-model-scope-save-in-single-provider');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByText('高级：自定义兼容接口',{exact:true}).click();
  assert.equal(await page.getByLabel('Anthropic Messages 地址',{exact:true}).inputValue(),'https://gateway.example/anthropic');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('button',{name:'添加供应商',exact:true}).click();
  await page.getByLabel('供应商预设',{exact:true}).selectOption('minimax-intl');
  assert.equal(await page.getByLabel('API 地址',{exact:true}).inputValue(),'https://api.minimax.io/v1');
  assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'MiniMax（国际 API）');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  checks.push('preset-fills-connection-and-mobile-layout-fits');
  await page.screenshot({path:path.join(out,'provider-connections-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const report={checks,errors,scope:'真实 React 组件和确定性 IPC；真实 HTTP 协议与鉴权由 tests/llm.test.ts 验证，未调用在线模型'};
  await fs.writeFile(path.join(out,'provider-connections-ui-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}catch(error){
  await fs.writeFile(path.join(out,'provider-connections-ui-failure.json'),JSON.stringify({checks,errors,error:String(error),body:await page?.locator('body').innerText()},null,2));
  throw error;
}finally{await browser?.close();await server.close()}
