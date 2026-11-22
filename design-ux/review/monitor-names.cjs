// Exercise the actual monitor IPC rows without starting a desktop window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, file);
const { CbimRuntime } = require('../../src/framework/cbim-runtime.ts');
const { RuntimeMonitor } = require('../../src/framework/monitor');
const { AgentRole } = require('../../src/framework/cability/agent');
const ipcMain = new EventEmitter();
let win, rows;
class MonitorWindow extends EventEmitter {
  constructor() {
    super();
    win = this;
    this.webContents = Object.assign(new EventEmitter(), {
      mainFrame: {}, setWindowOpenHandler() {},
      send(channel, update) { if (update.group === 'runtime') rows = update; }
    });
  }
  removeMenu() {}
  async loadFile() {}
  show() {}
  isDestroyed() { return false; }
}
global.MAIN_WINDOW_VITE_DEV_SERVER_URL = '';
global.MAIN_WINDOW_VITE_NAME = 'main';
const originalLoad = Module._load;
Module._load = function(id, ...args) {
  return id === 'electron' ? { BrowserWindow: MonitorWindow, ipcMain, app: { getAppMetrics: () => [] } } : originalLoad.call(this, id, ...args);
};
const { createMonitorOpener } = require('../../src/bridge/server/desktop/monitor-window.ts');
Module._load = originalLoad;

async function check(onSnapshot) {
  const names = new Map([['one', '甲项目'], ['two', '乙项目']]);
  const runtime = Object.assign(new CbimRuntime(), { ProjectName: id => names.get(id) });
  const monitor = new RuntimeMonitor(runtime);
  const member = { kind: 'agent', id: 'planner', agentId: 'shared', name: '游戏策划', position: '', available: true, model: { engine: 'member-engine', modelId: 'm', profileId: 'p' } };
  const factory = { CreateEngine: async () => ({ session: {}, Close: async () => {} }) };
  const engines = new Map();
  try {
    for (const id of names.keys()) {
      const office = runtime.OpenOffice(id, 'same-session');
      engines.set(office.id, id + '-engine');
      office.members.SetMembers([member]);
      await office.OpenMainAgent(factory);
      const worker = office.members.GetMember(member.id);
      await worker.Open(new AgentRole({ ...member, instructions: '' }, { workspaceId: id, taskId: 'task' }), factory);
    }
    const application = { monitor, offices: { ActiveEngine: id => engines.get(id) } };
    await createMonitorOpener({}, application, engine => ({ name: engine }))();
    const refresh = () => ipcMain.emit('monitor:start', { sender: win.webContents, senderFrame: win.webContents.mainFrame });
    refresh();
    if (process.argv.includes('--browser')) await checkView(rows);
    for (const [id, project] of names) {
      const office = runtime.OpenOffice(id, 'same-session');
      for (const [agent, name, engine] of [[office.mainAgentId, '助理', id + '-engine'], [office.members.GetMember(member.id).id, member.name, member.model.engine]]) {
        const title = project + ' · ' + name;
        assert.equal(rows.agents.find(row => row.id === agent).name, title);
        assert.ok(rows.engines.some(row => row.name === engine && row.detail.startsWith(title + ' · Agent ' + agent)));
      }
    }
    const other = runtime.OpenOffice('two', 'same-session');
    if (onSnapshot) {
      const originalNames = new Map(names);
      for (const [id, name] of originalNames) names.set(id, name + '（演示）');
      refresh();
      await onSnapshot(rows);
      for (const [id, name] of originalNames) names.set(id, name);
    }
    const worker = other.members.GetMember(member.id);
    await worker.Close();
    other.members.SetMembers([{ ...member, name: '关卡策划' }]);
    refresh();
    assert.equal(rows.agents.find(row => row.id === worker.id).name, '乙项目 · 关卡策划');
    names.delete('two');
    other.members.SetMembers([]);
    refresh();
    assert.equal(rows.agents.find(row => row.id === worker.id).name, '未知项目 · 未知 Agent');
    assert.ok(rows.agents.some(row => row.name === '甲项目 · 游戏策划'));
    console.log('PASS two projects, identical sessions and member names, main/member engine rows, idle rename, missing metadata and isolation');
  } finally {
    win?.emit('closed');
    monitor.Close();
    await runtime.Close();
  }
}
async function checkView(snapshot) {
  const bundle = await require('esbuild').build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client';
      import { ResourceMonitor } from './src/view/monitor/ResourceMonitor';
      createRoot(document.querySelector('#root')).render(<ResourceMonitor/>);
    ` },
    bundle: true, write: false, outdir: 'out', jsx: 'automatic',
    loader: { '.svg': 'dataurl', '.png': 'dataurl' }
  });
  const browser = await require('playwright-core').chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 580, height: 520 } });
    await page.setContent('<div id="root"></div>');
    await page.evaluate(value => { window.WatchProcesses = callback => { callback(value); return () => {}; }; }, snapshot);
    for (const file of bundle.outputFiles) {
      if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text });
      if (file.path.endsWith('.js')) await page.addScriptTag({ content: file.text });
    }
    for (const agent of snapshot.agents) await page.getByText(agent.name, { exact: true }).waitFor();
    for (const engine of snapshot.engines) await page.getByText(engine.detail, { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('PASS rendered Agent titles, engine associations and monitor width');
  } finally {
    await browser.close();
  }
}
module.exports = { check };
if (require.main === module) check().catch(error => { console.error(error); process.exitCode = 1; });
