/** Office 滑动窗渲染基准。独立 Edge 实例与临时生产构建，不读取用户数据。 */
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const outDir = await mkdtemp(path.join(os.tmpdir(), 'cbim-window-'));
const config = { configFile: 'vite.renderer.config.ts', logLevel: 'error', build: { outDir } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ channel: 'msedge' });
const results = [];
try {
  for (const [size, heavy] of [[2000,false],[100000,false],[1000000,false],[100000,true]]) {
    for (let run = 1; run <= 3; run++) {
      const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
      try {
        await page.addInitScript(({size, heavy}) => {
          let reads = 0;
          window.readCount = () => reads;
          const big = '## Report\n\n|Field|Value|\n|---|---|\n' + '|latency|18 ms|\n'.repeat(120) + '\n\n~~~js\n' + 'const value = 123;\n'.repeat(160) + '~~~';
          window.desktopMenu = {
            Projects: async () => [{id:'p',name:'bench',path:'bench'}],
            OpenOffice: async () => ({ id:'a',sessions:[{id:'a',title:'bench'}], earlier:Array.from({length:size},(_,i)=>String(i)),messages:[{id:'last',role:'user',text:'BENCH-END',created:0}] }),
            ReadOfficeTurn: async (_,__,id) => { reads++; await new Promise(r=>setTimeout(r,8)); return [{id,role:'assistant',text:'TURN-'+id+'\n\n'+(heavy?big:'Short test message.'),created:0}]; },
            WatchOffice:()=>()=>{}, Engines:async()=>({managed:false,items:[]}),Model:async()=>({profiles:[]})
          };
        }, {size,heavy});
        await page.goto(server.resolvedUrls.local[0]);
        const project = page.locator('.project-select').first();
        await project.waitFor();
        await page.evaluate(()=>document.querySelector('.project-select').addEventListener('click',()=>{window.openAt=performance.now()},{once:true}));
        await project.click();
        const end = page.getByText('BENCH-END',{exact:true});
        const open = await end.waitFor({timeout:4500}).then(()=>page.evaluate(()=>Math.round(performance.now()-window.openAt)),()=>null);
        const sample = await page.evaluate(async () => {
          const el=document.querySelector('.ui-window-list');
          const gaps=[];
          let maxRows=0;
          let maxNodes=0;
          let last=performance.now();
          const limits=[0,.1,.8,.3,.9,.02,.65,.15,0];
          // Each segment seeks then advances in small increments for eight frames.
          for (const fraction of limits) {
            el.scrollTop=fraction*(el.scrollHeight-el.clientHeight);
            for(let i=0;i<8;i++) {
              await new Promise(requestAnimationFrame);
              const now=performance.now();gaps.push(now-last);last=now;
              maxRows=Math.max(maxRows,el.querySelectorAll('.office-message-row').length);
              maxNodes=Math.max(maxNodes,el.getElementsByTagName('*').length);
              if(fraction)el.scrollTop+=140;
            }
          }
          gaps.sort((a,b)=>a-b);
          return {frames:gaps.length,p95:+gaps[Math.ceil(gaps.length*.95)-1].toFixed(1),max:+gaps.at(-1).toFixed(1),slow:gaps.filter(g=>g>50).length,maxRows,maxNodes,reads:window.readCount(),scrollHeight:el.scrollHeight};
        });
        const first=await page.getByText('TURN-0',{exact:true}).waitFor({timeout:2500}).then(()=>true,()=>false);
        await page.locator('.ui-window-list').hover();
        await page.locator('.office-jump').click({force:true});
        const back=await page.waitForFunction(()=>{const el=document.querySelector('.ui-window-list');const tail=[...el.querySelectorAll('article')].find(a=>a.textContent==='BENCH-END');if(!tail)return false; const rect=tail.getBoundingClientRect();const viewport=el.getBoundingClientRect();return rect.top<viewport.bottom && rect.bottom>viewport.top;},null,{timeout:3500}).then(()=>true,()=>false);
        results.push({size,heavy,run,open,first,back,...sample});
        console.log(JSON.stringify(results.at(-1)));
      } finally { await page.close(); }
    }
  }
  await writeFile(process.argv[2] ?? path.join(outDir,'results.json'),JSON.stringify({browser:browser.version(),cpu:os.cpus()[0].model,ramGiB:os.totalmem()/2**30,results},null,2));
} finally { await browser.close(); await new Promise(resolve=>server.httpServer.close(resolve)); }
