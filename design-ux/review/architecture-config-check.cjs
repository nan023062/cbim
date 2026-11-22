const assert=require('node:assert/strict');
module.exports=async (p,note)=>{
 const by=id=>p.locator('#'+id), click=id=>by(id).click(), fill=(id,value)=>by(id).fill(value);
 const text=id=>by(id).innerText(),wide=()=>p.setViewportSize({width:1160,height:800});
 const refresh=async(page,id)=>{await p.reload();await click(page);await click('node-'+id)};
 const fits=async()=>assert.ok(await p.evaluate(()=>[document.documentElement,...document.querySelectorAll('dialog[open]')].every(el=>el.scrollWidth<=el.clientWidth+1)));
 await wide();
 for(const role of ['resources','installer']){
  await refresh('organization',role);
  assert.match(await text('detail'),/尚未配置.*专属技能/);
  await click('skill-add');await fill('skill-name','交付核验');await fill('skill-content','逐项核对材料。');await click('skill-submit');
  await click('skill-edit-0');assert.equal(await by('skill-content').inputValue(),'逐项核对材料。');
  await fill('skill-content','修改并取消');await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>document.activeElement.id),'skill-edit-0');
  await click('skill-add');await fill('skill-name','交付核验');await fill('skill-content','重复');await click('skill-submit');assert.match(await text('skill-error'),/同名/);await click('skill-cancel');
  await click('skill-edit-0');assert.equal(await by('skill-content').inputValue(),'逐项核对材料。');await fill('skill-content','归档核验结果。');await click('skill-submit');
  for(const other of ['runtime','curator']){await click('node-'+other);assert.ok(!(await text('detail')).includes('归档核验结果。'))}
  await refresh('organization',role);assert.match(await text('detail'),/归档核验结果/);
  await click('skill-remove-0');await click('skill-cancel');await click('skill-remove-0');await click('skill-submit');
  assert.match(await text('detail'),/尚未配置.*专属技能/);note(role+' skills add/view/edit/duplicate/cancel/remove/refresh/isolation PASS');
 }
 await refresh('business','catalog');
 await click('flow-edit');await click('flow-add');await p.locator('[data-field=name]').fill('目录审核');await p.locator('[data-field=owner]').selectOption('resources');
 await click('flow-add');await p.locator('[data-field=name]').nth(1).fill('归档');await p.locator('[data-field=owner]').nth(1).selectOption('curator');
 await p.locator('[data-move="-1"]').nth(1).click();await click('flow-submit');
 assert.deepEqual(await p.locator('.step-summary small').allTextContents(),['资源维护岗','资源团队']);
 await click('flow-edit');await p.locator('[data-remove]').first().click();await click('flow-cancel');assert.equal(await p.locator('.step-summary').count(),2);
 await click('flow-edit');await p.locator('[data-remove]').first().click();await p.locator('[data-field=name]').fill('复核目录');await click('flow-submit');
 for(const label of ['交付清单','审核报告']){
  await click('output-add');await fill('output-name',label);await fill('output-description','汇总版本与来源');await fill('output-path','清单文档');await fill('output-criteria','版本一致\n来源可查');await click('output-submit');
 }
 await click('output-edit-0');await fill('output-criteria','一项已修改\n新增标准');await click('output-submit');
 await click('output-remove-1');await click('output-cancel');assert.equal(await p.locator('.output-item').count(),2);
 await click('output-remove-1');await click('output-submit');
 await click('output-edit-0');await fill('output-name','取消变更');await p.keyboard.press('Escape');
 await refresh('business','catalog');assert.match(await text('workflow'),/复核目录/);assert.match(await text('outputs'),/交付清单/);
 assert.deepEqual(await p.locator('.output-item li').allTextContents(),['一项已修改','新增标准']);
 for(const id of ['market','install']){await click('node-'+id);assert.ok(!(await text('workflow')).includes('复核目录'));assert.ok(!(await text('outputs')).includes('交付清单'))}
 note('Workflow step CRUD/order/owners and output items/criteria CRUD, cancellation, persistence and node isolation PASS');
 await refresh('organization','installer');await click('exec-edit');
 await click('engine-value');assert.equal(await p.locator('#engine-options label').count(),2);assert.equal(await p.locator('#engine-options label :is(img,svg)').count(),2);
 await p.locator('#engine-options input[value=review]').check();assert.equal(await text('model-value'),'复核模型');await click('exec-cancel');
 await click('exec-edit');assert.match(await text('engine-value'),/CBIM 本地示例引擎/);await click('model-value');assert.deepEqual(await p.locator('#model-options label').allTextContents(),['通用模型','审核模型']);await p.locator('#model-options input').nth(1).check();
 await p.locator('#connector-selected button').click();for(const id of ['records','workspace','catalog'])await p.locator('#connector-picker input[value='+id+']').check();
 await click('exec-save');await refresh('organization','installer');assert.match(await text('detail'),/审核模型/);
 const logos=p.locator('.execution-list .connector-logo');assert.deepEqual(await logos.evaluateAll(a=>a.map(b=>b.title)),['交付记录','工作区索引','本地资源目录']);
 await p.setViewportSize({width:320,height:700});await fits();await logos.first().focus();assert.equal(await logos.first().getAttribute('aria-label'),'交付记录');
 await p.keyboard.press('Enter');await fits();assert.equal(await p.locator('#connector-picker input:checked').count(),3);await p.locator('#connector-picker input[value=records]').uncheck();await p.keyboard.press('Escape');
 assert.equal(await logos.count(),3);
 await click('exec-edit');await click('engine-value');await p.locator('#engine-options input[value=review]').check();await click('exec-save');await refresh('organization','installer');assert.match(await text('detail'),/审核示例引擎[\s\S]*复核模型/);
 await click('tolist');await click('node-curator');assert.match(await text('detail'),/CBIM 本地示例引擎/);await click('skill-add');await fits();await p.keyboard.press('Escape');
 await refresh('business','catalog');await click('flow-edit');await fits();await p.keyboard.press('Escape');await click('output-add');await fits();await p.keyboard.press('Escape');
 note('Role engine logos, model display names, ordered connector logos/multiselect, save/cancel, refresh, isolation, 320px and keyboard PASS');
};
