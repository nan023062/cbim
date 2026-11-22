const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve('test-results/ux-full-1122-after');
fs.mkdirSync(output,{recursive:true});
const baseline=fs.readFileSync(path.join(__dirname,'ux-review-fixture.cjs'),'utf8');
const start=baseline.indexOf("await open('通用');"),end=baseline.indexOf('})();}finally');
assert.ok(start>=0&&end>start);
async function cases(open,page){
 const assert=require('node:assert/strict');
 for(const w of [390,1320])for(const theme of ['dark','light']){
   await open('通用',w,theme);
   assert.equal(await page.locator('aside nav button').count(),5);
   assert.equal(await page.getByRole('switch').count(),0);
   await page.locator('.preferences').getByRole('button',{name:'帮助',exact:true}).press('Enter');
   assert.ok(await page.getByRole('button',{name:'打开资源商城'}).isVisible());
   for(const [route,editor] of [['org','编辑资料与归属'],['biz','编辑业务节点']]){
     await open(route,w,theme);const search=page.getByRole('searchbox');
     await search.fill('不存在的条目');assert.equal(await page.getByRole('button',{name:editor}).count(),0);
     await search.fill('');await page.getByRole('button',{name:editor}).click();
     await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
   }
   await open('ext',w,theme);assert.equal(await page.getByRole('tab',{name:'定时任务（未开放）',exact:true}).count(),1);
   const address=page.getByRole('textbox',{name:'网址'});await address.fill('javascript:invalid');await address.press('Enter');await page.getByRole('alert').waitFor();
   await page.route('https://ux-fixture.invalid/**',r=>r.fulfill({body:'测试页面'}));
   await address.fill('https://ux-fixture.invalid/');await address.press('Enter');assert.equal(await page.getByRole('alert').count(),0);
   await open('home',w,theme);
   const settings=page.getByRole('button',{name:'设置',exact:true}).first();
   if(!await settings.isVisible()){const opener=page.getByRole('button',{name:/展开侧栏|显示侧栏|展开侧边栏/}).first();await opener.click()}
   await settings.click();await page.locator('.preferences').getByRole('button',{name:'帮助',exact:true}).click();await page.getByRole('button',{name:'打开资源商城'}).click();await page.getByRole('button',{name:'返回帮助'}).click();
   assert.equal(await page.locator('.preference-content h2').first().innerText(),'帮助');
   console.log(w,theme,'settings, help round trip, trees no-results/cancel, schedule entry, web recovery PASS');
 }
}
const script=baseline.slice(0,start)+'await ('+cases.toString()+')(open,page);'+baseline.slice(end);
fs.writeFileSync(path.join(output,'tasks.cjs'),script);
require(path.join(output,'tasks.cjs'));
