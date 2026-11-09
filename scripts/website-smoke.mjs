import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {releaseLinks} from './build-website.mjs';

// 使用独立无头浏览器，不连接开发者的浏览器资料；只读本次静态产物。
const base=process.env.CBIM_WEBSITE_TEST_URL||'http://127.0.0.1:4178/';
const output=path.resolve('test-results/branding-website');await fs.mkdir(output,{recursive:true});
const release=JSON.parse(await fs.readFile('website/release.json','utf8')),links=releaseLinks(release);
const browser=await chromium.launch({channel:'msedge',headless:true});
const cases=[],errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const colorScheme of ['light','dark'])for(const width of [320,390,1280])for(const file of ['index.html','download.html']){
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
    const response=await page.goto(new URL(file,base).href);assert.equal(response.status(),200);
    await page.getByRole('heading',{level:1}).waitFor();
    const measurements=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0),fonts:document.fonts.status}));
    assert.ok(measurements.scroll<=width,`${file} overflows ${width}: ${measurements.scroll}`);assert.ok(measurements.images);
    assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('title').textContent().then(t=>t.includes('CBIM Assistant')),true);
    if(file==='download.html'){
      assert.equal(await page.locator('[data-download]').getAttribute('href'),links.downloadUrl);
      await page.locator('.integrity summary').click();assert.equal((await page.locator('.integrity code').textContent()).trim(),release.sha256);
      await page.locator('.integrity summary').click();
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    if(width===320||width===1280)await page.screenshot({path:path.join(output,`${file.replace('.html','')}-${width}-${colorScheme}.png`),fullPage:true});
    cases.push({file,width,colorScheme,...measurements,passed:true});
  }
  // 每页拷贝到单独目录后仍能呈现；资源必须内联，不能意外依赖构建目录邻居。
  for(const file of ['index.html','download.html']){
    const dir=path.join(output,'standalone',file.replace('.html',''));await fs.mkdir(dir,{recursive:true});
    const target=path.join(dir,file);await fs.copyFile(path.join('build/website',file),target);
    await page.goto(pathToFileURL(target).href);await page.getByRole('heading',{level:1}).waitFor();
    assert.equal(await page.evaluate(()=>document.styleSheets.length),1);
    assert.equal(await page.locator('svg').count()>0,true);cases.push({file,standalone:true,passed:true});
  }
  await page.goto(new URL('index.html',base).href);await page.locator('.nav-download').click();await page.waitForURL('**/download.html');
  await page.locator('.brand').first().click();await page.waitForURL('**/index.html');
  await page.keyboard.press('Tab');
  assert.equal((await page.request.get(new URL('missing-page',base).href)).status(),404);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'website-report.json'),JSON.stringify({passed:true,base,release,links,cases,errors},null,2));
  console.log(JSON.stringify({passed:true,cases:cases.length,errors:errors.length,report:path.join(output,'website-report.json')}));
}finally{await browser.close()}
