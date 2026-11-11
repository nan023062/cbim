// 真实 React 组件 + 本机 Application/IPC 路由，独立 Edge 页面；不启动模型、不读取用户配置。
// 本项验证配置交互，不替代同一发行 EXE 与安装升级验收。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {fixture} from '../tests/helpers';
import {seedTeam} from '../tests/team-fixture';

const f=await fixture(),root=process.cwd(),out=path.resolve('test-results/agent-settings-ui-'+Date.now());await fs.mkdir(out,{recursive:true});
const actions:string[]=[],errors:string[]=[],checks:string[]=[];
const model={id:'shared',name:'Enabled model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false};
const base={name:'Chat',api:'openai-completions',baseUrl:'http://127.0.0.1:9',auth:'none',defaultModel:'shared',models:[model,{...model,id:'disabled',name:'Disabled model',enabled:false}]};
await f.app.models.save({profile:base});
const entry=await f.app.dispatch('add',{path:f.a});await seedTeam(f.app.workspace(entry.id));
const workspace=(await f.app.list()).entries.find(w=>w.id===entry.id)!;
const html='<div id="root"></div><script type="module" src="./fixture.mjs"></script>';
await fs.writeFile(path.join(out,'index.html'),html);
await fs.writeFile(path.join(out,'fixture.mjs'),String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
window.cbim={call:async(action,args={})=>{const response=await fetch('/__engine_ipc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,args})});const result=await response.json();if(!result.ok)throw Error(result.message);return result.value}};
const {Conversation}=await import('/src/frontend/conversation/Conversation.tsx');const {TeamView}=await import('/src/frontend/team/TeamView.tsx');const {ModelSettings}=await import('/src/frontend/settings/ModelSettings.tsx');
const workspace=`+JSON.stringify(workspace)+String.raw`;
function App(){const [view,setView]=useState('a'),[snapshot,setSnapshot]=useState(),[tabs,setTabs]=useState([{id:'a',kind:'conversation',title:'对话一',draft:''},{id:'b',kind:'conversation',title:'对话二',draft:''}]);
const refresh=async()=>setSnapshot(await window.cbim.call('snapshot',{id:workspace.id}));React.useEffect(()=>{void refresh()},[]);
return React.createElement(React.Fragment,null,React.createElement('nav',null,...['a','b','team','models'].map(id=>React.createElement('button',{key:id,onClick:()=>setView(id)},id))),
...tabs.map((tab,i)=>React.createElement('div',{key:tab.id,hidden:view!==tab.id,id:'conversation-'+tab.id,style:{height:'720px'}},React.createElement(Conversation,{conversations:tabs,runningTaskIds:[],onSelectConversation:()=>{},onRenameConversation:()=>{},onRemoveConversation:()=>{},workspace,tab,active:view===tab.id,onDraft:draft=>setTabs(old=>old.map((t,j)=>i===j?{...t,draft}:t)),onBind:()=>{},onAttachments:()=>{},openView:()=>{},openSettings:()=>setView('models')}))),
view==='team'&&React.createElement(TeamView,{workspace,snapshot,refresh}),view==='models'&&React.createElement(ModelSettings));}
createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'real-app-ipc',configureServer(server){server.middlewares.use('/__engine_ipc',async(req,res)=>{
  try{let raw='';for await(const chunk of req)raw+=chunk;const {action,args}=JSON.parse(raw);actions.push(action);if(['loop.chat','loop.resume','loop.enqueue'].includes(action))throw Error('此配置验收不授权启动模型');const value=await f.app.dispatch(action,args);res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,value}))}
  catch(error){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,message:String(error)}))}
})}}]});
let browser;try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+(server.httpServer!.address() as any).port+'/'+path.relative(root,out).replaceAll('\\','/')+'/index.html');
  const first=page.locator('#conversation-a'),second=page.locator('#conversation-b');
  const engine=(scope=first)=>scope.getByRole('combobox',{name:'Loop 引擎',exact:true});
  async function pick(label:string,value:string,scope=first){await scope.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('listbox',{name:label+'选项',exact:true}).getByRole('option',{name:value,exact:true}).click()}
  async function expectEngine(scope:typeof first,value:string){await page.waitForFunction(({id,value})=>document.querySelector(id+' [aria-label="Loop 引擎"]')?.textContent?.includes(value),{id:'#'+await scope.getAttribute('id'),value})}
  await engine().click();assert.deepEqual(await page.getByRole('listbox',{name:'Loop 引擎选项'}).getByRole('option').allTextContents(),['Pi','Claude Code','Codex']);await page.keyboard.press('Escape');
  await pick('Loop 引擎','Claude Code');await expectEngine(first,'Claude Code');await first.getByText('选择兼容模型后将保存主 Agent 配置。').waitFor();
  await first.getByRole('textbox',{name:'对话草稿',exact:true}).fill('保留主 Agent 配置测试草稿');assert.equal(await first.getByRole('button',{name:'发送消息',exact:true}).isEnabled(),false);
  checks.push('legacy-profile-all-three-engines','no-compatible-model-blocks-send');
  await pick('Loop 引擎','Pi');
  const anthropic=await f.app.models.save({profile:{...base,name:'Anthropic',api:'anthropic-messages'}}),anthropicId=anthropic.profiles.find(p=>p.name==='Anthropic')!.id;
  const responses=await f.app.models.save({profile:{...base,name:'Responses',api:'openai-responses'}}),responsesId=responses.profiles.find(p=>p.name==='Responses')!.id;
  await page.getByRole('button',{name:'b',exact:true}).click();await page.getByRole('button',{name:'a',exact:true}).click();
  await pick('Loop 引擎','Claude Code');await expectEngine(first,'Claude Code');
  await first.getByRole('combobox',{name:'对话模型',exact:true}).click();const list=page.getByRole('listbox',{name:'对话模型选项',exact:true});assert.match(await list.innerText(),/Anthropic/);assert.doesNotMatch(await list.innerText(),/Responses|Disabled model/);await page.keyboard.press('Escape');
  const identity={workspaceId:entry.id,instanceId:f.app.workspace(entry.id).instanceId};
  assert.deepEqual((await f.app.dispatch('agent.mainSettings',identity)).selection,{engine:'claude-code',profileId:anthropicId,modelId:'shared'});
  await pick('Loop 引擎','Pi');await expectEngine(first,'Pi');assert.equal((await f.app.dispatch('agent.mainSettings',identity)).selection.profileId,anthropicId);
  await pick('Loop 引擎','Claude Code');await expectEngine(first,'Claude Code');
  await page.getByRole('button',{name:'b',exact:true}).click();await expectEngine(second,'Claude Code');checks.push('shared-model-pi-and-claude','main-agent-shared-across-conversations');
  await page.getByRole('button',{name:'team',exact:true}).click();await page.getByTestId('team-main-agent-settings').click();const dialog=page.getByRole('dialog',{name:'主 Agent 配置',exact:true});
  await page.waitForFunction(()=>document.querySelector('[aria-label="主 Agent 配置"] select[aria-label="Agent Loop 引擎"]')?.value==='claude-code');
  assert.equal(await dialog.getByRole('combobox',{name:'Agent 模型',exact:true}).inputValue(),JSON.stringify([anthropicId,'shared']));
  await dialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('codex');await dialog.getByRole('combobox',{name:'Agent 模型',exact:true}).selectOption(JSON.stringify([responsesId,'shared']));await dialog.getByRole('button',{name:'保存主 Agent 配置',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'a',exact:true}).click();await expectEngine(first,'Codex');assert.equal(await first.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'保留主 Agent 配置测试草稿');checks.push('composer-to-agent-and-agent-to-composer','draft-preserved');
  assert.equal((await f.app.chatOptions(entry.id,{},[])).engine,'codex');
  await page.screenshot({path:path.join(out,'main-agent-shared.png')});
  await page.getByRole('button',{name:'models',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).first().click();assert.equal(await page.getByRole('combobox',{name:'Loop 引擎',exact:true}).count(),0);assert.equal(await page.getByRole('combobox',{name:'接口协议',exact:true}).isEnabled(),true);checks.push('provider-has-no-engine-setting');
  await page.reload();await expectEngine(first,'Codex');checks.push('shared-setting-survives-reload');
  const current=await f.app.dispatch('agent.mainSettings',identity);await f.app.dispatch('agent.configureMain',{...current,selection:null});
  for(const profile of (await f.app.models.list()).profiles)await f.app.models.remove(profile.id);
  await page.reload();await page.getByRole('button',{name:'team',exact:true}).click();await page.getByTestId('team-main-agent-settings').click();
  const empty=page.getByRole('dialog',{name:'主 Agent 配置',exact:true});
  await empty.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('claude-code');
  assert.equal(await empty.getByRole('combobox',{name:'Agent 模型',exact:true}).inputValue(),'');await empty.getByText('当前没有与 Claude Code 兼容的已启用模型，请在模型设置中检查接口协议与模型列表。').waitFor();
  checks.push('empty-catalog-agent-engines-remain-selectable');
  assert.deepEqual(errors,[]);assert.equal(actions.some(a=>['loop.chat','loop.resume','loop.enqueue'].includes(a)),false);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({success:true,checks,pageErrors:errors,modelRequests:0,limitations:['真实浏览器组件与 Application；未覆盖打包 EXE 或安装器。']},null,2));console.log(JSON.stringify({success:true,out,checks}));
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),stack:(error as Error).stack,errors,actions},null,2));throw error}
finally{await browser?.close();await server.close();await f.cleanup()}
