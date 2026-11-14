// 真实 App 与隔离 IPC 验证设置导航、草稿、外观持久化和窄屏布局，不访问生产数据或外部服务。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results/settings-center');
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/test-results/settings-center/fixture.tsx"></script></html>');
await fs.writeFile(path.join(out,'fixture.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/view/shell/shell.css';
const artifact=(id,version,kind='pi')=>({kind,identity:id.repeat(64),version,nativeVersion:'1.5.0',protocol:1,dependencies:[]});
window.fixture={calls:[],resourceFail:false,resourceSaveFail:false,
 models:{secureStorage:true,selectedId:'provider',profiles:[{id:'provider',name:'测试供应商',api:'openai-completions',baseUrl:'http://localhost:12345/v1',auth:'none',defaultModel:'model',models:[{id:'model',name:'可用生成模型',enabled:true,contextWindow:32768,maxTokens:4096}]}]},
 engines:{managed:true,revision:3,items:[{kind:'pi',enabled:true,active:artifact('a','1.0.0'),candidate:artifact('b','1.1.0'),installed:[artifact('a','1.0.0')],references:0,preparing:false},...['claude-code','codex','memory'].map((kind,i)=>({kind,enabled:true,candidate:artifact(['c','d','e'][i],'1.0.0',kind),installed:[],references:0,preparing:false}))]},
 resources:{session:{state:'signedOut'},source:'local',config:{mode:'local',location:'C:/CBIM/resources',repositoryId:'local-fixture'}},
 admission:{revision:1,maxConcurrentRuns:4},budget:{revision:1,enabled:false,limits:{}},
 web:{revision:1,enabled:false,hasKey:false,secureStorage:true,browserRobotsPolicy:'allow'},
 updates:{currentVersion:'0.1.17',currentNotes:'设置页验收夹具',enabled:true,phase:'current',enginePreparations:[{engine:'pi',version:'1.0.0',progress:42}]},
};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='list')return {entries:[]};
 if(action==='runtime.snapshot')return {workspaces:[],runs:[]};
 if(action==='models.list')return structuredClone(f.models);
 if(action==='models.save'){f.models.profiles=[{id:args.id||'provider',...args.profile}];return structuredClone(f.models)}
 if(action==='engines.settings'||action==='engines.check'){const snapshot=structuredClone(f.engines);if(action==='engines.settings'&&f.delayEngineRead){f.delayEngineRead=false;return new Promise(resolve=>{f.finishEngineRead=()=>resolve(snapshot)})}return snapshot}
 if(action==='engines.install'){assertCandidate(args);const item=f.engines.items.find(item=>item.kind===args.kind);item.preparing=true;item.preparation={identity:args.identity,version:item.candidate.version,progress:37};return new Promise(resolve=>{f.finishEngineInstall=()=>{f.engines.revision++;item.active=item.candidate;item.installed.push(item.active);item.preparing=false;delete item.preparation;resolve(structuredClone(f.engines))}})}
 if(action==='engines.configure'){if(args.action==='remove')throw Error('仍被启用的引擎依赖');f.engines.revision++;f.engines.items[0].enabled=args.action==='enable';return structuredClone(f.engines)}
 if(action==='resources.status'){if(f.resourceFail)throw Error('测试：仓库暂不可用');return structuredClone(f.resources)}
 if(action==='resources.configure'){if(f.resourceSaveFail)throw Error('测试：目录不可写');f.resources.config.location=args.location;return structuredClone(f.resources)}
 if(action==='resources.share'){f.resources.sharing={url:'http://127.0.0.1:45678',host:args.lan?'0.0.0.0':'127.0.0.1',port:args.port||45678};return structuredClone(f.resources)}
 if(action==='resources.stopSharing'){delete f.resources.sharing;return structuredClone(f.resources)}
 if(action==='resources.connection')return {...f.resources.sharing,token:'isolated-test-token'};
 if(action==='admission.settings')return structuredClone(f.admission);
 if(action==='admission.configure'){f.admission={...args,revision:args.revision+1};return structuredClone(f.admission)}
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:f.admission.revision},policy:structuredClone(f.admission),occupied:[],waiting:[]}};
 if(action==='budget.settings')return structuredClone(f.budget);
 if(action==='budget.configure'){f.budget={...args,revision:args.revision+1};return structuredClone(f.budget)}
 if(action==='web.settings')return structuredClone(f.web);
 if(action==='web.configure'){f.web={...f.web,...args,revision:args.revision+1,hasKey:!!args.apiKey&&!args.clearKey};return structuredClone(f.web)}
 if(action==='github.feedback.status')return {config:{clientId:'fixture-public-client',owner:'nan023062',repo:'cbim',visibility:'public'},secureStorage:true};
 if(action==='desktop.updates.status'||action==='desktop.updates.check')return structuredClone(f.updates);
 throw Error('Unexpected IPC '+action);
}};
function assertCandidate(args){if(args.identity!=='b'.repeat(64)||args.revision!==3)throw Error('wrong candidate')}
const {App}=await import('/src/view/shell/App.tsx');createRoot(document.getElementById('root')).render(<App/>);
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;const checks=[],errors=[];
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1040}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  const url='http://127.0.0.1:'+server.httpServer.address().port+'/test-results/settings-center/index.html';

  const sidebarMetrics=selector=>page.locator(selector).evaluate(node=>{
    const style=getComputedStyle(node),part=selector=>node.querySelector(selector),box=e=>e.getBoundingClientRect(),css=e=>getComputedStyle(e);
    const heading=part('.sidebar-top'),title=part('.sidebar-title'),search=part('.sidebar-search'),menu=part('.primary-nav>button:not(.selected)'),icon=menu.querySelector('svg');
    return {width:box(node).width,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],background:style.backgroundColor,border:style.borderRightColor,heading:{height:box(heading).height,gap:css(heading).gap,margin:css(heading).margin,font:css(title).fontSize,weight:css(title).fontWeight},search:{height:box(search).height,radius:css(search).borderRadius,padding:css(search).padding,font:css(search.querySelector('input')).fontSize},menu:{height:box(menu).height,radius:css(menu).borderRadius,padding:css(menu).padding,font:css(menu).fontSize,weight:css(menu).fontWeight,gap:css(menu).gap,icon:box(icon).width}};
  });
  await page.goto(url);
  const homeSidebar=page.locator('.workspace-sidebar');
  await homeSidebar.waitFor({state:'visible'});
  const appUpdate=homeSidebar.getByRole('button',{name:'版本与更新',exact:true});await appUpdate.hover();await page.getByRole('tooltip').waitFor();
  assert.equal(await appUpdate.getAttribute('aria-busy'),'false');assert.equal(await appUpdate.getByRole('progressbar').count(),0);assert.ok(!(await page.getByRole('tooltip').innerText()).includes('pi'));await page.mouse.move(600,500);
  checks.push('应用更新图标忽略旧宿主的引擎准备信息');
  assert.equal((await homeSidebar.boundingBox()).width,260);
  const homeResize=homeSidebar.getByRole('separator',{name:'调整侧边栏宽度',exact:true});
  await homeResize.focus();await homeResize.press('ArrowRight');await homeResize.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.workspace-sidebar').getBoundingClientRect().width===280);
  const homeMetrics=await sidebarMetrics('.workspace-sidebar');
  assert.equal(homeMetrics.heading.height,32);assert.equal(homeMetrics.search.height,30);assert.equal(homeMetrics.menu.height,32);
  await page.screenshot({path:path.join(out,'home-sidebar-desktop.png')});
  const openSettings=async()=>{await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.locator('.settings-navigation').waitFor({state:'visible'})};
  await openSettings();
  assert.deepEqual(await sidebarMetrics('.settings-navigation'),homeMetrics);
  const settingsResize=page.locator('.settings-navigation').getByRole('separator',{name:'调整侧边栏宽度',exact:true}),handle=await settingsResize.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(320,handle.y+100,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.settings-navigation').getBoundingClientRect().width===320);
  await page.getByRole('button',{name:'返回工作空间',exact:true}).click();
  assert.equal((await homeSidebar.boundingBox()).width,320);
  await homeResize.focus();await homeResize.press('Home');
  await page.waitForFunction(()=>document.querySelector('.workspace-sidebar').getBoundingClientRect().width===260);
  await openSettings();assert.equal((await page.locator('.settings-navigation').boundingBox()).width,260);
  await page.screenshot({path:path.join(out,'settings-sidebar-desktop.png')});
  checks.push('首页和设置侧栏几何一致，共享拖动/键盘宽度与默认恢复');

  const nav=page.getByRole('navigation',{name:'设置分类'});
  async function go(id,label){if(await page.locator('.settings-mobile-picker').isVisible())await page.locator('.settings-mobile-picker select').selectOption(id);else await nav.getByRole('button',{name:label,exact:true}).click();await page.locator('#settings-panel-'+id).waitFor({state:'visible'})}
  await page.getByText('测试供应商',{exact:true}).waitFor();
  assert.equal(await page.locator('.settings-panel:not([hidden])').count(),1);
  const initialCalls=await page.evaluate(()=>window.fixture.calls.map(c=>c.action));
  for(const action of ['resources.status','github.feedback.status','engines.settings','budget.settings'])assert(!initialCalls.includes(action),'eager read '+action);
  checks.push('按需加载，打开设置不启动其它配置读取');
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('保留的供应商草稿');
  await go('appearance','主题与个性化');await page.getByRole('button',{name:'浅色',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.getByLabel('对话正文字号',{exact:true}).selectOption('17');await page.getByLabel('代码块字号',{exact:true}).selectOption('16');await page.getByRole('switch',{name:'减少动态效果'}).check();
  assert.equal(await page.locator('.appearance-reading-preview p').evaluate(e=>getComputedStyle(e).fontSize),'17px');
  assert.equal(await page.locator('.appearance-reading-preview pre').evaluate(e=>getComputedStyle(e).fontSize),'16px');
  await page.evaluate(()=>{const el=document.createElement('div');el.className='chat-message';el.dataset.testid='text-probe';el.textContent='字体测试';document.body.append(el)});
  assert.equal(await page.getByTestId('text-probe').evaluate(e=>getComputedStyle(e).fontSize),'17px');await page.getByTestId('text-probe').evaluate(e=>e.remove());
  await page.locator('.settings-content').evaluate(e=>e.scrollTo(0,0));await page.screenshot({path:path.join(out,'appearance-light-desktop.png')});
  await page.getByRole('button',{name:'跟随系统',exact:true}).click();await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  checks.push('主题、系统配色与正文字号、代码字号、减少动效生效');
  await go('models','大模型');assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'保留的供应商草稿');
  await page.getByRole('button',{name:'保存供应商',exact:true}).click();await page.getByText('保留的供应商草稿',{exact:true}).waitFor();
  await go('engines','引擎');const selector=page.getByRole('combobox',{name:'选择引擎',exact:true});
  assert.deepEqual(await selector.locator('option').allTextContents(),['请选择引擎','Pi','Claude Code','Codex','记忆引擎']);assert.equal(await page.locator('.engine-detail').count(),0);
  await selector.selectOption('codex');assert.equal(await page.locator('.engine-detail').count(),1);await page.getByRole('article',{name:'Codex 引擎详情',exact:true}).getByRole('button',{name:'下载并安装',exact:true}).waitFor();
  await selector.selectOption('pi');await page.getByText('当前可用模型：保留的供应商草稿 / 可用生成模型',{exact:true}).first().waitFor();
  const pi=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Pi',exact:true})});
  await page.evaluate(()=>window.fixture.delayEngineRead=true);await pi.getByRole('button',{name:'刷新状态',exact:true}).click();await page.waitForFunction(()=>!!window.fixture.finishEngineRead);
  await pi.getByRole('button',{name:'更新引擎',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('progress[aria-label="引擎准备进度"]')?.value===37);assert.equal(await selector.isDisabled(),true);
  await go('accounts','账号与连接');await page.evaluate(()=>window.fixture.finishEngineInstall());await go('engines','引擎');
  await page.getByText('引擎已准备并启用；正在运行的任务保持原版本。',{exact:true}).waitFor();assert.equal(await selector.isDisabled(),false);assert.equal(await pi.getByRole('button',{name:'已安装当前版本',exact:true}).isDisabled(),true);assert.equal(await pi.getByRole('progressbar').count(),0);
  await page.evaluate(()=>window.fixture.finishEngineRead());await page.waitForTimeout(100);assert.equal(await pi.getByRole('button',{name:'已安装当前版本',exact:true}).isDisabled(),true);
  await pi.getByRole('button',{name:'停用',exact:true}).click();await pi.getByText('安装状态：已安装 · 已停用',{exact:true}).waitFor();await pi.getByRole('button',{name:'启用',exact:true}).click();await pi.getByText('安装状态：已安装 · 已启用',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'engine-detail-desktop.png')});
  checks.push('全部官方引擎可选择、单详情管理、安装中轮询进度、切页保持回执、迟到快照隔离、停启状态、同版本不重复安装');
  await go('models','大模型');await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('再次保存的供应商');await page.getByRole('button',{name:'保存供应商',exact:true}).click();
  await go('engines','引擎');await page.getByText('当前可用模型：再次保存的供应商 / 可用生成模型',{exact:true}).first().waitFor();
  await pi.getByRole('button',{name:'移除引擎',exact:true}).click();await page.getByRole('alert').filter({hasText:'仍被启用的引擎依赖'}).waitFor();
  checks.push('模型草稿跨页保留、真实保存入口与引擎返回刷新、准确候选安装、失败状态保留');
  await go('runtime','任务运行');await page.getByLabel('全局并发上限',{exact:true}).fill('7');await go('budget','用量与预算');
  await page.getByLabel('启用新目标软限额',{exact:true}).check();await page.getByLabel('Token 软限额',{exact:true}).fill('12345');
  await go('runtime','任务运行');assert.equal(await page.getByLabel('全局并发上限',{exact:true}).inputValue(),'7');await page.getByRole('button',{name:'保存并发设置',exact:true}).click();await page.getByText('已保存。新运行按此上限领取名额；正在执行的任务继续运行。',{exact:true}).waitFor();
  await go('budget','用量与预算');assert.equal(await page.getByLabel('Token 软限额',{exact:true}).inputValue(),'12345');await page.getByRole('button',{name:'保存软限额',exact:true}).click();await page.getByText('已保存，仅对之后创建的新目标生效。当前目标继续使用原来的额度。',{exact:true}).waitFor();
  const readsBefore=await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='admission.read').length);await page.waitForTimeout(1300);assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='admission.read').length),readsBefore);
  checks.push('运行与预算草稿保留、版本化保存、隐藏运行页退订');
  await page.evaluate(()=>{window.fixture.resourceFail=true});await go('resources','资源仓库');await page.getByRole('alert').filter({hasText:'仓库暂不可用'}).waitFor();
  await go('appearance','主题与个性化');await page.getByRole('button',{name:'深色',exact:true}).click();await go('resources','资源仓库');
  await page.evaluate(()=>{window.fixture.resourceFail=false});await page.getByRole('button',{name:'重新读取仓库',exact:true}).click();await page.getByLabel('本地仓库文件夹',{exact:true}).fill('C:/CBIM/new-resources');
  await page.evaluate(()=>{window.fixture.resourceSaveFail=true});await page.getByRole('button',{name:'保存本地目录',exact:true}).click();await page.getByRole('alert').filter({hasText:'目录不可写'}).waitFor();assert.equal(await page.getByLabel('本地仓库文件夹',{exact:true}).inputValue(),'C:/CBIM/new-resources');
  await go('appearance','主题与个性化');await go('resources','资源仓库');assert.equal(await page.getByLabel('本地仓库文件夹',{exact:true}).inputValue(),'C:/CBIM/new-resources');
  await page.evaluate(()=>{window.fixture.resourceSaveFail=false});await page.getByRole('button',{name:'保存本地目录',exact:true}).click();await page.getByText('已更新：链接器、人才市场、业务模板统一使用此仓库。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'启动仓库共享',exact:true}).click();await page.getByRole('button',{name:'显示连接信息',exact:true}).click();await page.getByLabel('共享令牌',{exact:true}).waitFor();assert.equal(await page.getByLabel('共享令牌',{exact:true}).getAttribute('type'),'password');await page.getByRole('button',{name:'停止共享',exact:true}).click();
  checks.push('仓库故障独立、重试保留输入、原共享和令牌路径可用');
  await go('accounts','账号与连接');await page.getByRole('button',{name:'连接并允许反馈自动提交',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'账号登录待接入',exact:true}).count(),0);
  await go('web','网页与搜索');await page.getByLabel('浏览器 robots 策略').selectOption('respect');await page.getByRole('button',{name:'保存网页设置',exact:true}).click();await page.getByText('网页设置已保存。',{exact:true}).waitFor();
  await go('about','关于与更新');await page.getByRole('button',{name:'查看更新与日志',exact:true}).click();await page.getByRole('dialog',{name:'版本与更新'}).waitFor();await page.getByRole('button',{name:'关闭版本与更新',exact:true}).click();await page.getByRole('button',{name:'检查桌面更新',exact:true}).click();
  const actions=await page.evaluate(()=>window.fixture.calls.map(c=>c.action));assert.equal(actions.filter(x=>x==='desktop.updates.check').length,1);for(const a of ['desktop.updates.install','desktop.updates.download','github.feedback.begin','github.feedback.openLogin'])assert(!actions.includes(a),'unrequested '+a);
  checks.push('账号与网页入口、共用更新详情，浏览不授权或安装');
  await page.getByRole('searchbox',{name:'搜索设置'}).fill('embedding');await nav.getByRole('button',{name:'大模型',exact:true}).click();await page.getByRole('heading',{name:'大模型',exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索设置'}).fill('不存在的设置');await page.getByRole('status').filter({hasText:'没有匹配的设置'}).waitFor();assert.equal(await page.locator('#settings-panel-models').isVisible(),true);await page.getByRole('button',{name:'清除设置搜索',exact:true}).click();
  checks.push('关键词搜索、无结果提示、不清空当前页面');
  await go('appearance','主题与个性化');await page.screenshot({path:path.join(out,'appearance-dark-desktop.png')});
  await page.reload();await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'主题与个性化',exact:true}).click();
  assert.equal(await page.getByLabel('对话正文字号',{exact:true}).inputValue(),'17');assert.equal(await page.getByRole('switch',{name:'减少动态效果'}).isChecked(),true);await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='cbim.appearance.v1')throw Error('quota');window.originalStorageSet.call(this,k,v)}});
  await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('alert').filter({hasText:'仅在当前窗口'}).waitFor();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet});await page.getByRole('button',{name:'重试保存外观',exact:true}).click();await page.getByRole('button',{name:'重试保存外观',exact:true}).waitFor({state:'hidden'});
  checks.push('重开继承偏好，存储失败可见且重试成功');
  assert.equal(await page.getByRole('button',{name:'收起侧栏',exact:true}).isVisible(),false);
  const pages=[['models','大模型'],['engines','引擎'],['accounts','账号与连接'],['appearance','主题与个性化'],['runtime','任务运行'],['budget','用量与预算'],['web','网页与搜索'],['resources','资源仓库'],['about','关于与更新']];
  for(const width of [320,390,800]){
    await page.setViewportSize({width,height:900});
    for(const [id,label] of pages){await go(id,label);if(id==='engines'){await page.getByRole('combobox',{name:'选择引擎',exact:true}).selectOption('pi');await page.screenshot({path:path.join(out,'engine-detail-'+width+'.png')})}const size=await page.evaluate(()=>({body:document.documentElement.scrollWidth,width:innerWidth,content:document.querySelector('.settings-content').scrollWidth,client:document.querySelector('.settings-content').clientWidth}));assert(size.body<=size.width+1,JSON.stringify({width,id,...size}));assert(size.content<=size.client+1,JSON.stringify({width,id,...size}))}
    await go('appearance','主题与个性化');await page.screenshot({path:path.join(out,'appearance-light-'+width+'.png')});await page.getByRole('button',{name:'深色',exact:true}).click();await page.screenshot({path:path.join(out,'appearance-dark-'+width+'.png')});await page.getByRole('button',{name:'浅色',exact:true}).click();
  }
  checks.push('320、390、800 px 九类设置无横向溢出，深浅色截图');
  await page.getByRole('button',{name:'恢复默认外观',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cbim.appearance.v1')).textSize===15);assert.equal(await page.getByRole('switch',{name:'减少动态效果'}).isChecked(),false);
  await page.getByRole('button',{name:'返回工作空间',exact:true}).click();await page.getByRole('heading',{name:'你的团队，新的工作方式',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,pageErrors:errors},null,2));console.log(JSON.stringify({checks,pageErrors:errors}));
}finally{await browser?.close();await server.close()}
