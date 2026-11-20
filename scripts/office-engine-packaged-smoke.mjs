// 打包主窗验收。下载源使用本次签名构建的原始 ZIP，模型使用本机已有配置。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright-core';
import { latestExecutable } from './build-artifact.mjs';

const executable = await latestExecutable();
const archives = path.resolve(path.dirname(executable), '../runtime');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-handoff-'));
const project = path.join(root, 'handoff-project');
const user = path.join(root, 'user');
const original = path.join(os.homedir(), '.cbim');
const marker = randomUUID();
let app;
try {
  await fs.mkdir(project);
  await fs.mkdir(path.join(user, 'desktop'), { recursive: true });
  for (const file of ['llm.json','desktop/Local State'])
    await fs.copyFile(path.join(original,file),path.join(user,file));
  const launch = async () => {
    app = await _electron.launch({ executablePath: executable, env: { ...process.env, CBIM_USER_DATA_ROOT: user }, timeout: 60000 });
    const page = await app.firstWindow();
    await page.locator('#application-home').waitFor();
    assert(await app.evaluate(({ app }) => app.isPackaged));
    return page;
  };
  let page = await launch();
  await app.evaluate(({ dialog }, { project, archives }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const fetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const asset = new URL(url);
      if (asset.origin === 'https://github.com' && asset.pathname.startsWith('/nan023062/cbim/releases/download/runtime-engines/') && asset.pathname.endsWith('.zip')) {
        const file = path.join(archives,path.basename(asset.pathname));
        return new Response(process.getBuiltinModule('stream').Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-length': String(fs.statSync(file).size) } });
      }
      return fetch(url,options);
    };
  }, { project, archives });
  await page.getByRole('button',{name:'执行引擎',exact:true}).click();
  for (const kind of ['pi','codex']) {
    const state = await page.evaluate(() => window.desktopMenu.Engines('list'));
    const item = state.items.find(i => i.kind === kind);
    assert(item?.candidate);
    const card = page.locator('.definition-card').filter({has:page.getByRole('heading',{name:item.candidate.plugin?.label ?? kind,exact:true})});
    await card.getByRole('button',{name:'下载并安装'}).click();
    await card.getByText(/当前版本/).waitFor({timeout:180000});
    console.log('installed',kind,item.candidate.version);
  }
  await page.getByRole('button',{name:'新建工作区',exact:true}).click();
  const engine = page.getByLabel('主 Agent 执行引擎');
  const messages = () => page.locator('.office-transcript article');
  async function send(kind, input) {
    await engine.selectOption(kind);
    await page.getByLabel('任务目标或补充消息').fill(input);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="停止回复"]') && (!!document.querySelector('.office-assistant') || !!document.querySelector('.office-dock [role="alert"]')), { }, {timeout:150000});
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
  assert.equal(await page.getByLabel('主 Agent 执行引擎').inputValue(),'codex');
  console.log('PASS: Pi → Codex, recalled '+marker+', all four messages and engine selection survived restart');
} finally {
  await app?.close();
  for (const file of ['llm.json','desktop/Local State']) await fs.rm(path.join(user,file),{force:true});
}
