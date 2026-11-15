// Actual Electron rendering + actual ModuleSourceBrowser on isolated files.
// No user project, model, installer or public update is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
import electronPath from 'electron';
import {ModuleSourceBrowser} from '../src/logic/workspace/service/source-browser';
import type {Snapshot} from '../src/logic/knowledge/rules/types';
const root=process.cwd(),parent=path.join(root,'test-results');await fs.mkdir(parent,{recursive:true});
const out=await fs.mkdtemp(path.join(parent,'architecture-tree-')),project=path.join(out,'project');await fs.mkdir(path.join(project,'src','nested'),{recursive:true});
await fs.writeFile(path.join(project,'src','main.ts'),'export const result = "<script>NOT_EXECUTED</script>";');
await fs.writeFile(path.join(project,'src','slow.ts'),'SLOW_OLD_FILE');
await fs.writeFile(path.join(project,'src','nested','child.ts'),'export const child = true;');
await fs.writeFile(path.join(project,'src','binary.bin'),Buffer.from([0,1,2]));
await fs.mkdir(path.join(project,'src','hidden'));await fs.writeFile(path.join(project,'src','hidden','private.txt'),'HIDDEN');
const moduleId='.cbim/workspace/app',agentId='.cbim/team/dev';
const snapshot:Snapshot={workspaceId:'workspace',instanceId:'instance',revision:'a'.repeat(64),files:[
 {path:moduleId+'/module.json',text:JSON.stringify({sources:[{location:'src',scope:'业务源码'}],overview:'module.md',workflows:[]}),hash:'m'},
 {path:'.cbim/workspace/broken/module.json',text:'{BROKEN_MODULE',hash:'broken'},
 {path:moduleId+'/module.md',text:'# 业务模块说明',hash:'md'},
 {path:agentId+'/agent.json',text:JSON.stringify({name:'研发 Agent',summary:'实现与验证',capabilities:['开发'],limitations:['核对需求'],work_principles:'principles.md',skills:[{name:'review',purpose:'审阅',reference:'skills/review/SKILL.md'}]}),hash:'a'},
 {path:agentId+'/principles.md',text:'# 工作原则\n核实真实证据。',hash:'p'},
 {path:agentId+'/skills/review/SKILL.md',text:'# 审阅流程',hash:'s'},
 {path:'.cbim/.cbimignore',text:'src/hidden/\n',hash:'i'}
],validation:{issues:[],indexes:{},structural:true,architecture:'review-required',business:'not-run',tree:{roots:[moduleId],nodes:{[moduleId]:{id:moduleId,name:'app',summary:'业务源码模块',sources:[{location:'src',scope:'业务源码'}],children:[]}}}}};
const browser=new ModuleSourceBrowser({entry:{id:snapshot.workspaceId,path:project},assert:input=>{assert.equal(input.workspaceId,snapshot.workspaceId);assert.equal(input.instanceId,snapshot.instanceId)},read:async()=>snapshot});
const html=path.join(out,'index.html'),main=path.join(out,'main.cjs');
await fs.writeFile(html,'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/scripts/architecture-tree-fixture.tsx"></script>');
await fs.writeFile(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:900,useContentSize:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});w.loadURL(process.env.CBIM_TREE_URL)});app.on('window-all-closed',()=>app.quit());`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'source-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 if(!req.url?.startsWith('/fixture/'))return next();
 res.setHeader('content-type','application/json');
 try{if(req.url==='/fixture/snapshot'){res.end(JSON.stringify(snapshot));return}let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('fixture body limit')}
 const input=JSON.parse(body),value=req.url==='/fixture/source.list'?await browser.list(input):req.url==='/fixture/source.read'?await browser.read(input):undefined;
 res.end(JSON.stringify({ok:true,value}));}catch(error){res.end(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}))}
})}}]});
const checks:string[]=[],errors:string[]=[];let desktop:Awaited<ReturnType<typeof _electron.launch>>|undefined;
try{
 await server.listen();const port=(server.httpServer!.address() as {port:number}).port;
 const env={...process.env,CBIM_TREE_URL:'http://127.0.0.1:'+port+'/'+path.relative(root,html).replaceAll('\\','/')};delete env.ELECTRON_RUN_AS_NODE;
 desktop=await _electron.launch({executablePath:electronPath as unknown as string,args:[main],env,timeout:60000});
 const page=await desktop.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('navigation',{name:'团队组织树',exact:true}).waitFor();
 assert.equal(await page.locator('.view-heading').count(),0);
 const team=page.getByRole('navigation',{name:'团队组织树',exact:true});
 assert.equal((await team.innerText()).includes('agent.json'),false);assert.equal((await team.innerText()).includes('skills'),false);
 await team.locator('[data-team-id="'+agentId+'"]').click();await page.getByRole('button',{name:'agent.json',exact:true}).click();
 await page.getByRole('region',{name:'知识文件预览'}).getByText(/capabilities/).waitFor();await page.getByRole('button',{name:'返回 研发 Agent 详情'}).click();
 await page.getByRole('button',{name:'principles.md',exact:true}).click();await page.getByRole('region',{name:'知识文件预览'}).getByText('核实真实证据。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'返回 研发 Agent 详情'}).click();
 assert.equal(await page.locator('.team-skill-list').getByText('review',{exact:true}).count(),1);
 checks.push('team-only-organization-config-and-skills-in-details');console.log(checks.at(-1));
 await team.getByLabel('团队架构的操作',{exact:true}).click();await team.getByRole('button',{name:'一键治理',exact:true}).click();await page.getByRole('alert').getByText(/启动结果未确认/).waitFor();
 await team.getByLabel('团队架构的操作',{exact:true}).click();assert.equal(await team.getByRole('button',{name:'一键治理',exact:true}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>(window as any).treeFixture.calls.filter((c:any)=>c.action==='loop.chat').length),1);
 checks.push('root-governance-unknown-receipt-cannot-replay');console.log(checks.at(-1));
 await page.getByRole('button',{name:'业务测试',exact:true}).click();
 const tree=page.getByRole('navigation',{name:'业务模块源码树'});await tree.waitFor();assert.equal(await page.locator('.view-heading').count(),0);
 assert.equal(await page.evaluate(()=>(window as any).treeFixture.calls.filter((c:any)=>c.action==='source.list').length),0);
 await page.getByText('未解析的模块配置',{exact:true}).click();await page.getByRole('button',{name:'.cbim/workspace/broken/module.json',exact:true}).click();await page.getByRole('region',{name:'知识文件预览'}).getByText('{BROKEN_MODULE',{exact:true}).waitFor();await page.getByRole('button',{name:'返回模块详情',exact:true}).click();
 await tree.locator('[data-module-id="'+moduleId+'"]').click();
 await page.getByText('模块配置资料',{exact:true}).click();await page.getByRole('button',{name:'module.json',exact:true}).click();await page.getByRole('region',{name:'知识文件预览'}).waitFor();await page.getByRole('button',{name:'返回模块详情',exact:true}).click();
 await tree.getByRole('button',{name:'展开源目录 src',exact:true}).click();await tree.getByRole('button',{name:'main.ts',exact:true}).waitFor();
 assert.equal((await tree.innerText()).includes('module.json'),false);assert.equal((await tree.innerText()).includes('hidden'),false);
 await tree.getByRole('button',{name:'展开源目录 nested',exact:true}).click();await tree.getByRole('button',{name:'child.ts',exact:true}).click();
 await page.getByRole('region',{name:'源文件预览'}).getByText('export const child = true;',{exact:true}).waitFor();
 await tree.getByRole('button',{name:'binary.bin',exact:true}).click();await page.getByText(/不是可预览的 UTF-8 文本/).waitFor();
 checks.push('actual-bound-directory-nesting-and-file-preview-no-knowledge-nodes');console.log(checks.at(-1));
 await page.evaluate(()=>(window as any).treeFixture.delay=true);await tree.getByRole('button',{name:'slow.ts',exact:true}).click();await page.waitForFunction(()=>(window as any).treeFixture.pending.length===1);
 await tree.getByRole('button',{name:'main.ts',exact:true}).click();await page.getByRole('region',{name:'源文件预览'}).getByText(/NOT_EXECUTED/).waitFor();
 await page.evaluate(()=>(window as any).treeFixture.pending.splice(0).forEach((resolve:any)=>resolve()));await page.waitForTimeout(100);
 assert.equal((await page.getByRole('region',{name:'源文件预览'}).innerText()).includes('SLOW_OLD_FILE'),false);assert.equal(await page.locator('.source-file-preview script').count(),0);
 checks.push('late-file-response-isolated-and-script-rendered-as-text');console.log(checks.at(-1));
 for(const [theme,width] of [['light',1440],['light',320],['dark',320]] as const){
  await desktop.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);await page.waitForFunction(width=>innerWidth===width,width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.waitForTimeout(200);
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,background:getComputedStyle(document.documentElement).getPropertyValue('--bg')}));console.log(JSON.stringify(dimensions));assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
  const png=await desktop.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await fs.writeFile(path.join(out,theme+'-'+width+'.png'),Buffer.from(png,'base64'));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as any).treeFixture.unexpected),[]);
 checks.push('desktop-and-320-light-dark-no-overflow');console.log(checks.at(-1));
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,checks,errors,out},null,2));console.log(JSON.stringify({ok:true,checks,out}));
}finally{await desktop?.close();await server.close()}
