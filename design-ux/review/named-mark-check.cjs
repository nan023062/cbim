// Run from the repository root with the installed desktop browser.
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

async function verify() {
  const bundle = await build({bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},stdin:{
    resolveDir:process.cwd(),loader:'tsx',contents:`
      import {createRoot} from 'react-dom/client';
      import {LogoLabel} from './src/framework-ui';
      import {EnginePackagesView} from './src/view/discovery/EnginePackagesView';
      import {MainAgentPicker} from './src/view/office/MainAgentPicker';
      import {useState} from 'react';
      const root=createRoot(document.querySelector('main'));window.calls=[];
      window.desktopMenu={EngineCatalog:async()=>['甲','乙'].map((label,i)=>({id:i?'second':'codex',label,logo:'data:image/png;base64,AAAA',businessTypes:[],supportedApis:[]})),Engines:async()=>({managed:true,items:[]}),Transfers:async()=>[],WatchTransfers:()=>()=>{}};
      window.pilot=()=>root.render(<EnginePackagesView/>);
      const noop=()=>{};
      function Picker(){const [value,change]=useState({engine:'codex'});return <MainAgentPicker value={value} change={change} disabled={false} fail={noop} onReady={noop} onManageModels={noop}/>;}
      window.office=()=>{window.desktopMenu.Model=async()=>({profiles:[]});window.desktopMenu.Engines=async()=>({items:[{kind:'codex',label:'甲',enabled:true,active:{}},{kind:'second',label:'乙',enabled:true,active:{}}]});root.render(<Picker/>);};
      window.draw=(extra={},action=false)=>root.render(<LogoLabel data={{id:'first',name:'技能',logo:{fallbackIcon:'skillBook'},tooltip:'技能说明',...extra}}
        onActivate={action?id=>window.calls.push(id):undefined}/>);
    `
  }});
  const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  try {
    const p=await browser.newPage();await p.setContent('<main></main>');await p.addScriptTag({content:bundle.outputFiles[0].text});
    await p.evaluate(()=>window.pilot());
    const engine=name=>p.getByRole('button',{name,exact:true});
    await engine('乙').click();await p.getByRole('article',{name:'乙 详情'}).waitFor();
    await engine('甲').press('Enter');await p.getByRole('article',{name:'甲 详情'}).waitFor();
    await engine('乙').press('Space');await p.getByRole('article',{name:'乙 详情'}).waitFor();
    await engine('乙').hover();assert.equal(await engine('乙').getAttribute('title'),'乙');
    assert.equal(await engine('乙').getAttribute('aria-current'),'true');
    assert.equal(await p.locator('.engine-detail h2 .logo-label').innerText(),'乙');
    await p.evaluate(()=>window.office());
    const trigger=p.getByRole('button',{name:'选择执行引擎',exact:true});
    await p.waitForFunction(()=>document.querySelector('.engine-trigger')?.textContent==='甲');
    await trigger.click();
    const choice=p.getByRole('button',{name:'乙',exact:true});
    assert.equal(await choice.locator('button').count(),0);
    await choice.press('Enter');
    await p.waitForFunction(()=>document.querySelector('.engine-trigger')?.textContent==='乙');
    assert.equal(await choice.isVisible(),false);
    console.log('Office picker keyboard selection, native popover dismissal and detail LogoLabel PASS');
    await p.evaluate(()=>window.draw());await p.getByText('技能',{exact:true}).waitFor();
    assert.equal(await p.getByRole('button').count(),0);
    await p.evaluate(()=>window.draw({selected:false},true));
    const button=p.getByRole('button');await button.click();await button.press('Enter');await button.press('Space');
    assert.deepEqual(await p.evaluate(()=>window.calls),['first','first','first']);
    assert.equal(await button.getAttribute('aria-current'),null);
    await p.evaluate(()=>window.draw({name:'工作流',disabledReason:'已停用',selected:true,logo:{fallbackIcon:'workflow',src:'data:image/png;base64,AAAA'}},true));
    await p.getByRole('button',{name:'工作流'}).waitFor();assert.ok(await button.isDisabled());assert.equal(await button.getAttribute('aria-current'),'true');
    await p.waitForFunction(()=>!document.querySelector('main img')&&!!document.querySelector('main svg'));
    await button.evaluate(el=>el.click());assert.equal(await p.evaluate(()=>window.calls.length),3);
    console.log('Static, controlled update, pointer, Enter/Space, disabled and decoded image failure PASS');
  } finally {await browser.close()}
}
verify().catch(error=>{console.error(error);process.exitCode=1});
