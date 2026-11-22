// 正式仓库下载验收；只在隔离用户目录中读取本机加密模型配置。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright-core';
import { latestExecutable } from './build-artifact.mjs';

const executable = await latestExecutable();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-handoff-'));
const project = path.join(root, 'handoff-project');
const user = path.join(root, 'user');
const original = path.join(os.homedir(), '.cbim');
const marker = randomUUID();
const managementOnly = process.argv.includes('--manage-only');
let app;
try {
  await fs.mkdir(project);
  await fs.mkdir(path.join(user, 'desktop'), { recursive: true });
  for (const file of managementOnly ? [] : ['llm.json','desktop/Local State'])
    await fs.copyFile(path.join(original,file),path.join(user,file));
  const launch = async () => {
    app = await _electron.launch({ executablePath: executable, env: { ...process.env, CBIM_USER_DATA_ROOT: user }, timeout: 60000 });
    const page = await app.firstWindow();
    await page.locator('#application-home').waitFor();
    assert(await app.evaluate(({ app }) => app.isPackaged));
    return page;
  };
  let page = await launch();
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  await page.evaluate(() => window.desktopMenu.Engines('check'));
  await page.getByRole('button',{name:'执行引擎',exact:true}).click();
  for (const kind of ['pi','codex']) {
    const state = await page.evaluate(() => window.desktopMenu.Engines('list'));
    const item = state.items.find(i => i.kind === kind);
    assert(item?.candidate && !item.active);
    await page.locator('.engine-list button').filter({has:page.getByText(item.label,{exact:true})}).click();
    const card = page.getByRole('article',{name:item.label+' 详情'});
    await card.getByRole('button',{name:'下载并安装'}).click();
    const deadline = Date.now() + 600000;
    for (;;) {
      const snapshot = await page.evaluate(() => window.desktopMenu.Engines('list'));
      const row = snapshot.items.find(entry => entry.kind === kind);
      if (row?.active?.identity === item.candidate.identity) break;
      if (row?.error || Date.now() > deadline) throw Error(row?.error ?? 'Engine installation timed out');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const installed = await page.evaluate(() => window.desktopMenu.Engines('list'));
    assert.equal(installed.items.find(i => i.kind === kind)?.active?.identity,item.candidate.identity);
    console.log('installed',kind,item.candidate.version,item.candidate.identity);
  }
  await page.getByRole('button',{name:'新建工作区',exact:true}).click();
  const engine = page.getByLabel('助理执行引擎');
  const messages = () => page.locator('.office-transcript article');
  const draft = page.getByLabel('任务目标或补充消息');
  if (managementOnly) {
  await draft.fill(marker);
  await engine.selectOption(':manage');
  const packageState = await page.evaluate(() => window.desktopMenu.Engines('list'));
  const codexLabel = packageState.items.find(item => item.kind === 'codex').label;
  await page.locator('.engine-list button').filter({has:page.getByText(codexLabel,{exact:true})}).click();
  const codexCard = page.getByRole('article',{name:codexLabel+' 详情'});
  await codexCard.getByRole('button',{name:'停用',exact:true}).click();
  await codexCard.getByRole('button',{name:'启用',exact:true}).click();
  await codexCard.getByRole('button',{name:'停用',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回工作区'}).click();
  assert.equal(await draft.inputValue(),marker);
  await page.waitForFunction(() => document.querySelector('select[aria-label="助理执行引擎"]')?.value === 'codex');
    console.log('PASS: install, disable, enable, return to Office with original draft and engine');
  } else {
  async function send(kind, input) {
    await engine.selectOption(kind);
    const model = page.getByLabel('助理大模型');
    if (!await model.inputValue()) await model.selectOption({ index: 1 });
    const count = await messages().count();
    console.log('sending',kind,await model.locator('option:checked').innerText());
    await page.getByLabel('任务目标或补充消息').fill(input);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.waitForFunction(count => !document.querySelector('button[aria-label="停止回复"]') && (document.querySelectorAll('.office-transcript article').length >= count + 2 || !!document.querySelector('.office-dock [role="alert"]')), count, {timeout:150000});
    const error = await page.locator('.office-dock [role="alert"]').allTextContents();
    assert.equal(error.join(''),'');
  }
  await send('pi','请记住此验收编号 '+marker+'，仅回复已记住。');
  const before = await messages().allTextContents();
  assert.equal(before.length,2);
  await send('codex','只回答上一轮我给你的验收编号。');
  const after = await messages().allTextContents();
  assert.deepEqual(after.slice(0,2),before);
  assert.equal(after.length,4);
  assert(after[3].includes(marker),'新引擎未复述原编号');
  await app.close();
  app = undefined;
  page = await launch();
  await page.getByRole('button',{name:'handoff-project',exact:true}).click();
  await page.locator('.office-assistant').first().waitFor();
  assert.deepEqual(await messages().allTextContents(),after);
  assert.equal(await page.getByLabel('助理执行引擎').inputValue(),'codex');
  console.log('PASS: Pi → Codex, recalled '+marker+', all four messages and engine selection survived restart');
  }
} finally {
  await app?.close();
  for (const file of ['llm.json','desktop/Local State']) await fs.rm(path.join(user,file),{force:true});
}
