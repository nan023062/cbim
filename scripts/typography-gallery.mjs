// 汇总本次真实截图为可离线查看的单文件，不生成或修改界面图片。
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const base='test-results',files=[];
for(const dir of ['settings-center','typography-pages'])for(const file of (await fs.readdir(path.join(base,dir))).sort()){
if(!file.endsWith('.png')||file==='light-check.png')continue;
if(dir==='settings-center'&&!/^(type-|updates-|appearance-large-zoom-)/.test(file))continue;
files.push(path.join(dir,file));
}
files.push('agent-call-mobile.png','engine-menu-mobile.png');
const manifest=[],cards=[];
for(const file of files){const data=await fs.readFile(path.join(base,file));manifest.push({file,sha256:crypto.createHash('sha256').update(data).digest('hex'),bytes:data.length});cards.push('<details data-name="'+file+'"><summary>'+file+'</summary><img loading="lazy" alt="'+file+'" src="data:image/png;base64,'+data.toString('base64')+'"></details>')}
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CBIM 排版截图验收</title><style>body{font:15px/1.6 system-ui;margin:24px auto;padding:0 16px;max-width:1400px;color:#20242c;background:#f7f8fa}h1{font-size:22px;font-weight:500}input{font:inherit;padding:10px;width:100%;box-sizing:border-box}summary{cursor:pointer;overflow-wrap:anywhere;padding:12px}details{border:1px solid #cbd0d8;border-radius:8px;margin:12px 0;background:white}img{display:block;max-width:100%;height:auto}button{font:inherit;padding:8px;margin:8px 8px 0 0}</style><h1>CBIM 字号与字重 · 截图验收</h1><p>普通界面 15px / 400，结构标题 500，代码默认 14px。共 '+files.length+' 张实际截图。真实 React 页面与隔离数据，非已安装版本的业务／升级验收；部分业务页面仅覆盖空态或不可用状态。</p><input id="query" placeholder="按页面、light / dark、1440 / 390 / 320、bottom 筛选" aria-label="筛选截图"><button id="expand">展开当前结果</button><button id="collapse">收起全部</button><main>'+cards.join('')+'</main><script>const all=[...document.querySelectorAll("details")];query.oninput=()=>{const words=query.value.toLowerCase().split(/\\s+/);all.forEach(d=>d.hidden=!words.every(w=>d.dataset.name.toLowerCase().includes(w)))};expand.onclick=()=>all.filter(d=>!d.hidden).forEach(d=>d.open=true);collapse.onclick=()=>all.forEach(d=>d.open=false);</script></html>';
await fs.writeFile(path.join(base,'typography-review.html'),html);await fs.writeFile(path.join(base,'typography-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({screenshots:files.length,bytes:Buffer.byteLength(html)}));
