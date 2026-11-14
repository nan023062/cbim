// 使用本机已配置模型的真实在线验收；只复制加密配置到独立 profile。
// 通过真实 Application/IPC/引擎验证团队话题，模型回复不使用替身；不更改生产配置。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {_electron, type ElectronApplication, type Page} from 'playwright-core';
import electronPath from 'electron';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {seedTeam} from '../tests/team-fixture';
import {request} from '../tests/data/knowledge';
import {registerExplicitFixtureOwner} from '../tests/explicit-owner-fixture';
import {usageScopes} from '../tests/scope-usage-fixture';

// 可以在原始日志上补核身份和上下文，不重发付费模型请求，也不改写原验收报告。
async function verifyMemberEvidence(report: Record<string, any>) {
  const tasks = report.graph.tasks;
  const workspaceId = tasks[0].identity.workspaceId;
  const userRoot = path.join(report.temp, 'user', workspaceId);
  const journal = (await fs.readFile(path.join(userRoot, 'dispatch/dispatch.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const sessions = new Map<string, any>();
  for (const entry of journal) for (const session of entry.body.mutation.teamSessions ?? []) sessions.set(session.sessionId, session);
  const members = [...sessions.values()].filter(session => session.rootSessionId === report.rootSessionId && session.agentId === tasks[0].assignee.agentId);
  assert.equal(members.length, 1, '同一办公室的同一 Agent 必须只登记一个逻辑会话');
  const evidence = [];
  for (const task of tasks) {
    assert.equal(task.candidateReview?.decision, 'accept');
    const runId = task.result.runId;
    const events = (await fs.readFile(path.join(userRoot, 'dispatch/runs/tasks', task.taskId, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const bound = events.find(event => event.type === 'session.bound');
    assert.ok(bound?.data.sessionFile);
    const relative = path.relative(userRoot, bound.data.sessionFile);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const native = await fs.readFile(bound.data.sessionFile, 'utf8');
    const second = task.scopeId === report.queuedTopicId;
    const expected = second ? 'OFFICE_BETA_7318' : 'OFFICE_ALPHA_9462';
    const foreign = second ? 'OFFICE_ALPHA_9462' : 'OFFICE_BETA_7318';
    assert.ok(native.includes(expected), '成员应实际读取当前话题的文件标记');
    assert.ok(!native.includes(foreign), '成员原生上下文不应携带其他话题的结果');
    assert.ok(task.result.summary.includes(expected), '回传结果应包含真实文件标记');
    evidence.push({taskId: task.taskId, scopeId: task.scopeId, runId, nativeSessionId: bound.data.sessionId, expected, foreignContextAbsent: true});
  }
  assert.equal(new Set(evidence.map(item => item.nativeSessionId)).size, 2, '不同话题应使用独立原生上下文');
  return {logicalMemberSession: members[0].sessionId, evidence};
}

if (process.argv[2] === '--verify-report') {
  const input = path.resolve(process.argv[3]);
  const report = JSON.parse(await fs.readFile(input, 'utf8'));
  assert.equal(report.passed, true);
  const evidence = await verifyMemberEvidence(report);
  await fs.writeFile(path.join(path.dirname(input), 'member-context-evidence.json'), JSON.stringify(evidence, null, 2), {flag: 'wx'});
  console.log(JSON.stringify({passed: true, evidence}));
  process.exit(0);
}

const repo = process.cwd();
await fs.mkdir('test-results', {recursive: true});
const output = await fs.mkdtemp(path.resolve('test-results/office-online-'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cbim-office-online-'));
const user = path.join(temp, 'user'), project = path.join(temp, 'office-project');
await fs.mkdir(project);
await fs.mkdir(path.join(user, 'desktop'), {recursive: true});
const report: Record<string, any> = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  startedAt: new Date().toISOString(), output, temp, realProvider: true, checks: [], pageErrors: [],
};
let setup: Application | undefined, desktop: ElectronApplication | undefined, page: Page | undefined;
let workspaceId: string | undefined, rootSessionId: string | undefined;
const call = (action: string, args: unknown = {}): Promise<any> =>
  page!.evaluate(({action, args}) => (window as any).cbim.call(action, args), {action, args});
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  await fs.copyFile(path.join(os.homedir(), '.cbim/llm.json'), path.join(user, 'llm.json'));
  await fs.copyFile(path.join(os.homedir(), '.cbim/desktop/Local State'), path.join(user, 'desktop/Local State'));
  setup = new Application(new Paths(user, repo), path.join(repo, 'design'));
  await setup.init();
  const models = await setup.models.list();
  const model = models.profiles.find(item => item.id === models.selectedId);
  assert.ok(model, '本机没有默认模型');
  report.model = {name: model.name, model: model.defaultModel};
  const entry = await setup.dispatch('add', {path: project});
  workspaceId = entry.id;
  const workspace = setup.workspace(entry.id), team = await seedTeam(workspace);
  const snapshot = await workspace.snapshot(), modulePath = team.input.moduleId + '/module.json';
  const definition = JSON.parse(snapshot.files.find(file => file.path === modulePath)!.text);
  definition.maintenance = {bindingId: 'online-maintainer', maintainerPersonIds: ['owner'], revision: 1,
    state: 'active', confirmation: {recordId: 'online-review', source: 'local_user', confirmedAt: new Date().toISOString()}};
  await workspace.commit(request(snapshot, [
    {path: modulePath, text: JSON.stringify(definition)},
    {path: '.cbim/team/people.json', text: JSON.stringify({people: [{id: 'owner', name: '验收维护人', team: '.cbim/team'}]})},
  ]));
  await registerExplicitFixtureOwner(setup, entry.id, {agentId: team.input.agentId,
    moduleIds: [team.input.moduleId], profileId: model.id, modelId: model.defaultModel, name: '在线验收执行员'});
  await fs.writeFile(path.join(project, 'office-alpha.txt'), 'OFFICE_ALPHA_9462\n');
  await fs.writeFile(path.join(project, 'office-beta.txt'), 'OFFICE_BETA_7318\n');
  await setup.shutdown(); setup = undefined;

  const env = {...process.env, CBIM_USER_DATA_ROOT: user};
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'CBIM_RUNTIME_SIGNING_KEY']) delete env[key];
  const executable = process.env.CBIM_TEST_EXE;
  let args: string[] = [];
  if (!executable) {
    const compiled = path.resolve(process.env.CBIM_OFFICE_COMPILED ?? 'test-results/office-online-20261114-a/compiled');
    await fs.access(path.join(compiled, 'build/desktop.js'));
    const wrapper = path.join(output, 'main.cjs');
    await fs.writeFile(wrapper, `require('electron').app.setAppPath(${JSON.stringify(repo)});require(${JSON.stringify(path.join(compiled, 'build/desktop.js'))});`);
    args = [wrapper];
    report.runtime = 'compiled Electron development entry';
  } else report.runtime = path.resolve(executable);
  desktop = await _electron.launch({executablePath: executable ?? electronPath, args, env, timeout: 60000});
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.waitForFunction(() => !!(window as any).cbim);
  assert.equal(path.resolve(await desktop.evaluate(({app}) => app.getPath('userData'))), path.resolve(user, 'desktop'));
  await call('open', {id: entry.id});
  const options = {engine: 'pi', profileId: model.id, model: model.defaultModel, permission: 'execute',
    collaborationMode: 'team', turnTimeoutMs: 120000};
  const goal = (file: string) => `这是隔离工作区的在线模型验收。请以团队模式完成一个极小任务：必须派发给模块 ${team.input.moduleId} 已登记的在线验收执行员，使用已有工作流 ${team.input.workflowId} 读取工作区根目录 ${file}，返回文件实际完整内容。不要自己代替成员读取。不要安装依赖或联网，业务文件只读，不修改架构或负责人。按实际工具契约登记目标计划、派发并启动，等待成员回传后审阅真实候选与目标，完成本话题。不询问用户，不编造结果；最终回复包含实际文件标记及成员证据。`;
  const started = await call('loop.chat', {id: entry.id, message: goal('office-alpha.txt'), options});
  rootSessionId = started.taskId;
  report.rootSessionId = rootSessionId;
  const queued = await call('loop.enqueue', {id: entry.id, taskId: rootSessionId, message: goal('office-beta.txt'), options});
  report.queuedTopicId = queued.id;
  console.log(JSON.stringify({stage: 'online-started', output, model: report.model, rootSessionId}));
  const deadline = Date.now() + 9 * 60000;
  let last = 0, scopes: any[] = [];
  while (Date.now() < deadline) {
    scopes = await usageScopes(user, entry.id);
    const runs = await call('loop.thread', {id: entry.id, taskId: rootSessionId});
    if (Date.now() - last > 15000) {
      console.log(JSON.stringify({stage: 'online-progress', topics: scopes.map(s => ({id: s.scopeId, status: s.status, outcome: s.outcome})),
        runs: runs.map((r: any) => ({id: r.runId, status: r.status}))})); last = Date.now();
    }
    if (scopes.length === 2 && scopes.every(scope => scope.status === 'closed')) break;
    if (scopes.some(scope => scope.status === 'awaiting_user' || scope.status === 'blocked'))
      throw Error('在线任务进入等待或阻塞，请检查真实任务证据');
    await pause(1000);
  }
  report.scopes = scopes;
  assert.equal(scopes.length, 2, '两个需求应分别建立话题');
  assert.ok(scopes.every(scope => scope.status === 'closed' && scope.outcome === 'completed'), '在线话题没有全部完成');
  assert.equal(scopes[1].scopeId, queued.id);
  const graph = await call('dispatch.graphSnapshot', {identity: {workspaceId: entry.id, rootSessionId}});
  report.graph = graph;
  assert.ok(graph.tasks.length >= 2, '没有真实成员派发');
  assert.equal(new Set(graph.tasks.map((task: any) => task.scopeId)).size, 2);
  const runs = await call('loop.thread', {id: entry.id, taskId: rootSessionId});
  report.mainRuns = runs;
  report.memberEvidence = await verifyMemberEvidence(report);
  report.checks.push('真实在线主成员协作', '新任务排队并独立建立话题', '两个话题均经真实目标审阅完成');
  report.checks.push('同角色一个逻辑会话', '不同话题的成员原生上下文和结果隔离');
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); process.exitCode = 1;
} finally {
  if (page && workspaceId && rootSessionId) {
    report.finalScopes = await usageScopes(user, workspaceId).catch(() => []);
    report.finalRuns = await call('loop.thread', {id: workspaceId, taskId: rootSessionId}).catch(() => []);
    report.runDetails = await Promise.all(report.finalRuns.map((run: any) =>
      call('loop.inspect', {id: workspaceId, taskId: rootSessionId, runId: run.runId}).catch(() => undefined)));
    if (!report.passed) await call('loop.stop', {id: workspaceId, taskId: rootSessionId}).catch(() => {});
    await page.screenshot({path: path.join(output, 'conversation.png'), timeout: 5000}).catch(() => {});
  }
  await desktop?.close(); await setup?.shutdown();
  await fs.rm(path.join(user, 'llm.json'), {force: true});
  await fs.rm(path.join(user, 'desktop/Local State'), {force: true});
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({passed: report.passed, output, error: report.error, checks: report.checks}));
}
