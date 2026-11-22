// Run from the repository root with the installed desktop browser.
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

async function verify() {
  const bundle = await build({bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},stdin:{
    resolveDir:process.cwd(),loader:'tsx',contents:`
      import {createRoot} from 'react-dom/client';
      import {ListItem,Tooltip} from './src/framework-ui';
      import {EnginePackagesView} from './src/view/discovery/EnginePackagesView';
      import {MainAgentPicker} from './src/view/office/MainAgentPicker';
      import {useState} from 'react';
      const root=createRoot(document.querySelector('main'));window.calls=[];
      window.desktopMenu={EngineCatalog:async()=>['甲','乙'].map((label,i)=>({id:i?'second':'codex',label,logo:'data:image/png;base64,AAAA',businessTypes:[],supportedApis:[]})),Engines:async()=>({managed:true,items:[]}),Transfers:async()=>[],WatchTransfers:()=>()=>{}};
      window.pilot=()=>root.render(<EnginePackagesView/>);
      const noop=()=>{};
      function Picker(){const [value,change]=useState({engine:'codex'});return <MainAgentPicker compact={Boolean(window.compact)} value={value} change={change} disabled={false} fail={noop} onReady={noop} onManageModels={noop}/>;}
      window.office=()=>{window.desktopMenu.Model=async()=>({profiles:[]});window.desktopMenu.Engines=async()=>({items:[{kind:'codex',label:'甲',enabled:true,active:{}},{kind:'second',label:'乙',enabled:true,active:{}}]});root.render(<Picker/>);};
      window.draw=()=>root.render(<Tooltip text="不可用"><ListItem disabled onClick={()=>window.calls.push('unexpected')}>停用</ListItem></Tooltip>);
    `
  }});
  const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  try {
    const p=await browser.newPage();await p.setContent('<main></main>');await p.addStyleTag({path:'src/framework-ui/styles/ui.css'});await p.addScriptTag({content:bundle.outputFiles[0].text});
    await p.evaluate(()=>window.pilot());
    const engine=name=>p.getByRole('button',{name,exact:true});
    await engine('乙').click();await p.getByRole('article',{name:'乙 详情'}).waitFor();
    await engine('甲').press('Enter');await p.getByRole('article',{name:'甲 详情'}).waitFor();
    await engine('乙').press('Space');await p.getByRole('article',{name:'乙 详情'}).waitFor();
    await engine('乙').hover();await p.getByRole('tooltip',{name:'乙'}).waitFor();
    assert.equal(await engine('乙').getAttribute('aria-describedby'),await p.getByRole('tooltip',{name:'乙'}).getAttribute('id'));
    await engine('乙').press('Escape');await p.getByRole('tooltip',{name:'乙'}).waitFor({state:'hidden'});
    assert.equal(await engine('乙').getAttribute('aria-current'),'true');
    assert.equal(await p.locator('.engine-detail h2').innerText(),'乙');
    await p.evaluate(()=>window.office());
    const trigger=p.getByRole('button',{name:'选择执行引擎',exact:true});
    await p.waitForFunction(()=>document.querySelector('.engine-trigger')?.textContent==='甲');
    await trigger.click();
    const choice=p.getByRole('button',{name:'乙',exact:true});
    assert.equal(await choice.locator('button').count(),0);
    await choice.press('Enter');
    await p.waitForFunction(()=>document.querySelector('.engine-trigger')?.textContent==='乙');
    assert.equal(await choice.isVisible(),false);
    await p.addStyleTag({path:'src/view/office/office.css'});
    await p.addStyleTag({content:'main {position:fixed;right:10px;bottom:10px}'});
    await p.evaluate(()=>{window.compact=true;window.office()});
    for(const width of [390,1320]){
      await p.setViewportSize({width,height:640});
      await trigger.click();
      const a=await trigger.boundingBox(), m=await p.locator('.engine-options:popover-open').boundingBox();
      assert.ok(m && m.y>0 && Math.abs(m.y+m.height-a.y)<10 && m.x<a.x+a.width && m.x+m.width>a.x && m.x+m.width<=width,JSON.stringify({a,m,width}));
      await p.keyboard.press('Escape');
      await p.locator('.engine-options:popover-open').waitFor({state:'hidden'});
    }
    await p.evaluate(()=>window.draw()); const disabled=p.getByRole('button',{name:'停用'});assert.ok(await disabled.isDisabled());await p.mouse.move(500,400);await disabled.locator('..').hover();await p.getByRole('tooltip',{name:'不可用'}).waitFor();await disabled.evaluate(el=>el.click());assert.deepEqual(await p.evaluate(()=>window.calls),[]);
    console.log('Engine selection, tooltip, disabled row and Office picker PASS');
  } finally {await browser.close()}
}
verify().catch(error=>{console.error(error);process.exitCode=1});
