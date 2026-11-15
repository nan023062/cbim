/** 隔离浏览器验证单人原型入口与本地交接演示；不替代真实任务或桌面验收。 */
import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
try{
 for(const width of [1440,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});
  await page.goto(pathToFileURL(path.resolve('design/cbim-complete-ux-prototype.html')).href+'#handoff');
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert.equal(await page.locator('h1').textContent(),'本地 Agent 交接');
  assert.equal(await page.locator('[data-route="people"]').count(),0);
  assert.equal(await page.locator('[data-action="comment"]').count(),0);
  await page.getByRole('button',{name:'模拟接续验证',exact:true}).click();
  assert.match(await page.locator('dialog').innerText(),/验证 Agent.*不代表验证通过/);
  await page.locator('[data-action="confirm-modal"]').click();
  await page.selectOption('#scenario','normal');
  await page.getByRole('button',{name:'模拟退回补齐',exact:true}).click();
  assert.match(await page.locator('dialog').innerText(),/保留原任务关联/);
  await page.locator('[data-action="confirm-modal"]').click();
  for(const state of ['blocked','conflict','unknown']){
   await page.selectOption('#scenario',state);
   assert.equal(await page.locator('.page-body').getAttribute('inert')!==null,['conflict','unknown'].includes(state));
  }
  await page.selectOption('#scenario','normal');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{document.querySelectorAll('*').forEach(el=>{if(el.scrollTop)el.scrollTop=0});window.scrollTo(0,0)});
  await page.waitForTimeout(400);
  await page.screenshot({path:`test-results/single-user-handoff-${width}-${theme}.png`,fullPage:true});
  checks.push({width,theme,handoff:'passed',recovery:'passed',overflow:false});
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({checks,errors},null,2));
 await fs.writeFile('test-results/single-user-prototype.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
