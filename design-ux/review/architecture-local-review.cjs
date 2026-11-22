const { chromium }=require(require.resolve('playwright-core',{paths:[process.cwd()]}));
const fs=require('fs'), path=require('path'), os=require('os'),url=require('url'),assert=require('assert/strict');
const log=path.join(os.tmpdir(),'cbim-architecture-review.log');
fs.writeFileSync(log,'');const note=x=>{fs.appendFileSync(log,x+'\n');console.log(x)};
(async()=>{
const file=path.resolve('design-ux/src/view/office/architecture-preview.html'), browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND','--disable-sync']});
try{
const ctx=await browser.newContext({offline:true,viewport:{width:1160,height:800},colorScheme:'light',reducedMotion:'reduce'});
const p=await ctx.newPage(),errors=[],requests=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
p.setDefaultTimeout(3500);
const click=id=>p.locator('#'+id).click(),visible=id=>p.locator('#'+id).isVisible(),focus=()=>p.evaluate(()=>document.activeElement.id);
const title=async t=>assert.equal(await p.locator('#detailtitle').innerText(),t);
const nooverflow=async()=>assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await p.goto(url.pathToFileURL(file).href);await title('资源商城');await nooverflow();assert.ok(await visible('tree'));assert.ok(await visible('detail'));
for(const page of ['business','organization']){await click(page);await p.mouse.move(1,1);await p.screenshot({fullPage:true,path:'design-ux/src/view/office/'+page+'-architecture-preview.png'});note('PNG '+page+' '+JSON.stringify(await p.viewportSize()))}note('Desktop 1160 x 800 split layout and both screenshots PASS');
const all=p.locator('#toggle-all');
const arrow=await all.locator('svg').elementHandle();
async function expectAction(label){
 assert.equal(await p.locator('.navhead button').count(),1);
 assert.equal(await all.getAttribute('aria-label'),label);
 assert.equal(await all.getAttribute('title'),label);
 assert.equal(await p.locator('#all-label').getAttribute('aria-hidden'),'true');
 assert.ok(await arrow.evaluate(el=>el===document.querySelector('#toggle-all svg')));
 const expected=label==='全部展开'?0:90;
 await p.waitForFunction(angle=>{
   const matrix=new DOMMatrix(getComputedStyle(document.querySelector('#toggle-all svg')).transform);
   return Math.abs(Math.atan2(matrix.b,matrix.a)*180/Math.PI-angle)<.01
     && Number(getComputedStyle(document.querySelector('#all-collapse')).opacity)===angle/90
     && Number(getComputedStyle(document.querySelector('#all-expand')).opacity)===1-angle/90;
 },expected);
}
await click('business');
await expectAction('全部收起');
await p.emulateMedia({reducedMotion:'no-preference'});
async function checkMidpoint(reverse){
 const trace=await all.evaluate(async(button,reverse)=>{
   const arrow=button.querySelector('svg'),expand=document.querySelector('#all-expand'),collapse=document.querySelector('#all-collapse');
   function sample(){
     const m=new DOMMatrix(getComputedStyle(arrow).transform);
     return {angle:Math.atan2(m.b,m.a)*180/Math.PI,expand:+getComputedStyle(expand).opacity,collapse:+getComputedStyle(collapse).opacity,width:button.offsetWidth,name:button.getAttribute('aria-label')};
   }
   const start=sample();
   button.click();
   const next=sample().name;
   for(let frame=0;frame<50;frame++){
     await new Promise(requestAnimationFrame);
     const mid=sample();
     if(mid.collapse>.15 && mid.collapse<.85){
       if(reverse)button.click();
       return {start,next,mid,after:sample()};
     }
   }
   throw Error('No intermediate chevron/crossfade frame');
 },reverse);
 assert.notEqual(trace.next,trace.start.name);
 assert.equal(trace.mid.width,trace.start.width);
 assert.ok(Math.abs(trace.mid.expand+trace.mid.collapse-1)<.01);
 assert.ok(Math.abs(trace.mid.angle/90-trace.mid.collapse)<.02);
 if(reverse){
   assert.equal(trace.after.name,trace.start.name);
   assert.ok(Math.abs(trace.after.angle-trace.mid.angle)<1);
   assert.ok(Math.abs(trace.after.expand-trace.mid.expand)<.02);
 }
}
for(const page of ['business','organization']){
 await click(page);
 for(const label of ['全部展开','全部收起']){
   await checkMidpoint(false);
   await expectAction(label);
 }
 await checkMidpoint(true);
 await expectAction('全部收起');
 note(page+' synchronized arrow and crossfade, endpoints, intermediate frames and rapid reversal PASS');
}
await click('business');
assert.equal(await arrow.evaluate(el=>getComputedStyle(el).transitionDuration),'0.2s');
assert.equal(await arrow.evaluate(el=>getComputedStyle(el).transitionTimingFunction),'ease-in-out');
await all.focus();
await p.keyboard.press('Enter');
await expectAction('全部展开');
assert.equal(await focus(),'toggle-all');
assert.equal(await visible('node-market'),false);
await p.keyboard.press('Space');
await expectAction('全部收起');
assert.equal(await focus(),'toggle-all');
await click('toggle-market');
await expectAction('全部展开');
assert.equal(await visible('node-install'),false);
await click('toggle-all');
assert.ok(await visible('node-install'));
await expectAction('全部收起');
note('Single control, keyboard focus, icon and tooltip transitions, mixed to all expanded PASS');
await click('toggle-market');
await click('organization');
await expectAction('全部收起');
await p.emulateMedia({reducedMotion:'reduce'});
assert.equal(await arrow.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
for(const id of ['all-expand','all-collapse']){
 assert.equal(await p.locator('#'+id).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
}
await click('toggle-all');
await expectAction('全部展开');
await click('toggle-all');
await expectAction('全部收起');
note('Chevron DOM retained, right/down orientation, normal 0.2s and reduced 0s PASS');
await click('toggle-resources');
await expectAction('全部展开');
await click('business');
await expectAction('全部展开');
assert.equal(await visible('node-install'),false);
await click('organization');
assert.equal(await visible('node-curator'),false);
await click('toggle-resources');
await expectAction('全部收起');
await click('business');
await expectAction('全部展开');
note('Independent tab states and manual branch toggles PASS');
await p.locator('#search').fill('资源安装');
assert.ok(await all.isDisabled());
assert.ok(await visible('node-install'));
await click('node-install');
await p.locator('#search').fill('');
await expectAction('全部展开');
assert.equal(await visible('node-install'),false);
note('Filtered paths, disabled action and pre-search expansion restored after selection PASS');
await p.locator('#search').fill('资源安装');assert.ok(await visible('node-install'));await click('node-install');await title('资源安装');await click('owner');await title('安装维护岗');await click('returnbiz');await title('资源安装');assert.equal(await focus(),'owner');assert.equal(await p.locator('#search').inputValue(),'资源安装');
await p.locator('#search').fill('');await click('node-engines');await click('link-choices');await title('模型选择');note('Business search ancestors, expand/collapse, child workspace, owner and return PASS');
await click('organization');await click('node-resources');await click('link-curator');await title('资源维护岗');assert.match(await p.locator('#detail').innerText(),/岗位专属技能[\s\S]*执行配置/);await click('parent');await title('资源团队');note('Organization team, member, parent, skills and execution configuration PASS');
for (const page of ['business','organization']){await click(page);for (const dark of [true,false]){await click('theme');assert.equal(await p.evaluate(()=>document.documentElement.classList.contains('dark')),dark);note(page+' '+(dark?'dark':'light')+' '+await p.locator('#panel').evaluate(e=>getComputedStyle(e).backgroundColor))}}note('Dark and light modes on both pages PASS');
await click('size');assert.ok(await p.locator('#panel').evaluate(e=>e.clientWidth<=408));await click('size');note('Desktop right panel compact/maximized PASS');
await p.setViewportSize({width:320,height:720});await p.reload();await nooverflow();assert.equal(await visible('detail'),false);await click('node-market');await nooverflow();assert.equal(await visible('tree'),false);await click('link-install');await nooverflow();await click('owner');await nooverflow();await title('安装维护岗');await p.keyboard.press('Escape');assert.equal(await focus(),'owner');await title('资源安装');await p.keyboard.press('Escape');assert.equal(await focus(),'link-install');await title('资源商城');await p.keyboard.press('Escape');assert.equal(await focus(),'node-market');await click('organization');await nooverflow();await title('安装维护岗');assert.equal(await visible('tree'),false);await click('tolist');assert.equal(await focus(),'node-installer');await nooverflow();await click('node-curator');await nooverflow();await click('tolist');assert.equal(await focus(),'node-curator');note('320px single-column list/detail, both pages and horizontal overflow PASS');note('Escape cross-page, nested detail, keyboard focus restored at each level PASS');
await require('./architecture-config-check.cjs')(p,note);
assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith('file:')||u.startsWith('data:')));note('Offline file load, no external requests and no page errors PASS');
}finally{await browser.close()}
})().catch(e=>{note(e.stack);process.exitCode=1});
