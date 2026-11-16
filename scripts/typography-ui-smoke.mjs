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
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/view/styles';
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

let browser;const results=[];
try{
await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/settings-center/index.html');
await page.locator('.workspace-sidebar').waitFor();
await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
const pages=[['models','大模型'],['accounts','账号与连接'],['appearance','主题与个性化'],['runtime','任务运行'],['budget','用量与预算'],['web','网页与搜索'],['resources','资源仓库'],['about','关于与更新']];
for(const theme of ['light','dark'])for(const width of [1440,390,320]){
await page.setViewportSize({width,height:1000});if(await page.locator('.settings-mobile-picker').isVisible())await page.locator('.settings-mobile-picker select').selectOption('appearance');else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'主题与个性化',exact:true}).click();await page.getByRole('button',{name:theme==='light'?'浅色':'深色',exact:true}).click();
for(const [id,label]of pages){if(process.env.CBIM_UI_PAGES&&!process.env.CBIM_UI_PAGES.split(',').includes(id))continue;
if(await page.locator('.settings-mobile-picker').isVisible())await page.locator('.settings-mobile-picker select').selectOption(id);else await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:label,exact:true}).click();
await page.locator('#settings-panel-'+id).waitFor({state:'visible'});await page.waitForTimeout(150);
const metrics=await page.evaluate(()=>({body:document.documentElement.scrollWidth,width:innerWidth,font:getComputedStyle(document.body).fontSize,weight:getComputedStyle(document.body).fontWeight}));
await page.screenshot({animations:'disabled',path:path.join(out,'type-'+id+'-'+theme+'-'+width+'.png'),fullPage:true});
if(id==='about'){await page.getByRole('button',{name:'查看更新与日志',exact:true}).click();await page.getByRole('dialog',{name:'版本与更新'}).waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'updates-'+theme+'-'+width+'.png')});await page.getByRole('button',{name:'关闭版本与更新',exact:true}).click();}const content=page.locator('.settings-content');await content.evaluate(n=>n.scrollTop=n.scrollHeight);await page.screenshot({animations:'disabled',path:path.join(out,'type-'+id+'-'+theme+'-'+width+'-bottom.png'),fullPage:true});await content.evaluate(n=>n.scrollTop=0);results.push({id,theme,width,...metrics});assert.equal(metrics.font,'15px');assert.equal(metrics.weight,'400');assert.ok(metrics.body<=width+1,JSON.stringify(results.at(-1)));
}}

await page.setViewportSize({width:1440,height:1000});await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'主题与个性化',exact:true}).click();
await page.getByLabel('界面字号',{exact:true}).selectOption('17');await page.getByLabel('代码字号',{exact:true}).selectOption('16');
assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).fontSize),'17px');assert.equal(await page.locator('.appearance-reading-preview code').evaluate(n=>getComputedStyle(n).fontSize),'16px');
for(const zoom of [1.25,1.5]){await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);await page.screenshot({animations:'disabled',path:path.join(out,'appearance-large-zoom-'+zoom+'.png')});}
await page.evaluate(()=>document.documentElement.style.zoom='1');await page.getByRole('button',{name:'恢复默认外观',exact:true}).click();
assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).fontSize),'15px');
await fs.writeFile(path.join(out,process.env.CBIM_UI_PAGES?'typography-extra-results.json':'typography-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({screenshots:results.length,results}));
}finally{await browser?.close();await server.close()}
