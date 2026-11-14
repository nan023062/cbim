// Isolated Electron renderer acceptance, with real React components and in-memory public IPC.
// This does not install CBIM, open the user's project, call an online model or validate the packaged backend.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
import electronPath from 'electron';

const root=process.cwd(),parent=path.join(root,'test-results');
await fs.mkdir(parent,{recursive:true});
const out=await fs.mkdtemp(path.join(parent,'office-desktop-'));
const checks=[],screenshots=[],pageErrors=[];
const baseline=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const html=path.join(out,'index.html'),main=path.join(out,'main.cjs');
await fs.writeFile(html,'<meta name="viewport" content="width=device-width, initial-scale=1"><title>CBIM office desktop acceptance</title><div id="root"></div><script type="module" src="/scripts/office-team-ui-fixture.tsx"></script>');
await fs.writeFile(main,`const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});
app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1280,height:1200,useContentSize:true,title:'CBIM isolated office acceptance',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});window.loadURL(process.env.CBIM_OFFICE_PREVIEW_URL)});
app.on('window-all-closed',()=>app.quit());`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let desktop,page;
try{
 await server.listen();
 const url='http://127.0.0.1:'+server.httpServer.address().port+'/'+path.relative(root,html).split(path.sep).join('/');
 const env={...process.env,CBIM_OFFICE_PREVIEW_URL:url};delete env.ELECTRON_RUN_AS_NODE;
 desktop=await _electron.launch({executablePath:electronPath,args:[main],env,timeout:60000});
 page=await desktop.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
 await page.waitForFunction(()=>window.fixture?.marker==='office-team-v1');
 assert.equal(new URL(page.url()).hostname,'127.0.0.1');

 const pane=page.locator('.workspace-panel:not([hidden])');
 await page.locator('.workspace-conversations').getByRole('button',{name:'象棋研发办公室',exact:true}).click();
 await pane.getByRole('tab',{name:'对话',exact:true}).waitFor();
 assert.equal(await pane.getByRole('tab',{name:'自动化',exact:true}).count(),0);
 assert.equal(await pane.getByRole('tab',{name:'对话',exact:true}).getAttribute('aria-selected'),'true');
 await pane.getByRole('textbox',{name:'对话草稿',exact:true}).fill('保留主草稿');
 await pane.getByRole('tab',{name:'办公室',exact:true}).click();
 await pane.locator('.office-scene').waitFor();
 await page.locator('.workspace-conversations').getByRole('button',{name:'象棋研发办公室',exact:true}).click();
 assert.equal(await pane.getByRole('tab',{name:'办公室',exact:true}).getAttribute('aria-selected'),'true');
 const children=page.locator('.workspace-conversations .conversation-child').first();
 await children.locator('summary').click();
 await children.getByRole('button',{name:/查看 规则执行员/}).click();
 assert.equal(await pane.getByRole('tab',{name:'办公室',exact:true}).getAttribute('aria-selected'),'true');
 await pane.locator('[data-office-actor="executor-logical"][data-selected="true"]').waitFor();
 await pane.getByRole('tab',{name:'对话',exact:true}).click();
 await pane.locator('.member-conversation').waitFor();
 assert.equal(await pane.locator('.chat-composer').count(),0);
 assert.equal(await pane.getByRole('textbox',{name:'对话草稿',exact:true}).count(),0);
 await pane.getByRole('button',{name:'返回所属主频道补充需求',exact:true}).click();
 await pane.locator('.conversation-topic-thread').waitFor();
 assert.equal(await pane.locator('.chat-scroll [data-tool-call-id],.chat-scroll .work-status').count(),0);
 checks.push('member-read-only-and-explicit-channel-return-chat-has-no-tools');
 await page.locator('.workspace-conversations').getByRole('button',{name:'象棋研发办公室',exact:true}).click();
 assert.equal(await pane.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'保留主草稿');
 checks.push('two-modes-and-sidebar-keeps-mode-and-main-draft');
 await page.getByRole('button',{name:'展开右侧扩展',exact:true}).click();
 await page.getByRole('button',{name:'新增空页签',exact:true}).click();
 await page.getByRole('button',{name:'打开自动化',exact:true}).click();
 await page.locator('.extension-area').getByText('还没有自动化任务。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'收起扩展区',exact:true}).click();
 checks.push('automation-in-right-extension');
 assert.equal((await page.evaluate(()=>window.fixture.calls.filter(c=>/loop\.(enqueue|stop|chat|resume|topicInterrupt)$/.test(c.action)))).length,0);
 assert.deepEqual(pageErrors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.errors),[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({checks,pageErrors,source:'real Electron/React App with isolated IPC',baseline},null,2));
 console.log(JSON.stringify({ok:true,out,checks}));
}finally{await desktop?.close();await server.close()}
