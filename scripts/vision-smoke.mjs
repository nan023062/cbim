// Real packaged Electron/Pi and local deterministic transport; no paid provider calls.
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-vision-smoke-'));
const root=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(root);
let app;const requests=[];
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data:[{id:'vision-test',context_window:32768,max_output_tokens:4096,input:['text','image']}]}));return}
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
 res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({id:'image-test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:'图片传输测试完成'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const exe=await latestExecutable();app=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});const page=await app.firstWindow();
 const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
 const entry=await call('add',{path:root});
 await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
 const settings=page.getByRole('region',{name:'模型供应商'});await settings.getByRole('button',{name:'添加供应商',exact:true}).click();
 await settings.getByRole('textbox',{name:'名称',exact:true}).fill('视觉测试');await settings.getByRole('textbox',{name:'API 地址',exact:true}).fill('http://127.0.0.1:'+server.address().port+'/v1');
 await settings.locator('select').nth(1).selectOption('none');await settings.getByRole('button',{name:'获取模型列表',exact:true}).click();await settings.getByRole('button',{name:'＋ vision-test',exact:true}).click();
 assert.equal(await settings.getByLabel('支持图片输入（视觉）',{exact:true}).isChecked(),true);
 await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/vision-settings.png'});
 await settings.getByRole('button',{name:'保存供应商',exact:true}).click();await settings.getByRole('button',{name:'编辑',exact:true}).waitFor();
 const file=path.join(root,'image.png');
 const png=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.from([0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255]),{width:2,height:2}).toPNG().toString('base64'));await fs.writeFile(file,Buffer.from(png,'base64'));
 await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},file);
 await page.getByLabel('添加上下文',{exact:true}).click();await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('button',{name:'移除附件 image.png',exact:true}).waitFor();
 // Use the actual composer so the attachment identity crosses the renderer IPC too.
 const input=page.locator('textarea').filter({visible:true});await input.fill('描述图片');await input.press('Enter');
 await page.waitForFunction(()=>document.body.innerText.includes('图片传输测试完成'),{},{timeout:30000});
 assert.equal(requests.length,1);const images=requests[0].messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(x=>x.type==='image_url'):[]);assert.equal(images.length,1);assert.ok(images[0].image_url.url.startsWith('data:image/png;base64,'));
 await page.screenshot({path:'test-results/vision-conversation.png'});const evidence={exe,realPi:true,realProvider:false,modelCapabilityDiscovery:true,imageAttachmentViaComposer:true,providerReceivedImage:true};await fs.writeFile('test-results/vision-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
