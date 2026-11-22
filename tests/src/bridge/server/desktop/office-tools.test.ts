import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { OfficeTools } from '../../../../../src/bridge/server/desktop/office-tools';
import { managedNativeTools } from '../../../../../src/engine-plugins/native-tools';
import { codexTools } from '../../../../../src/engine-plugins/codex/tools';
import type { EngineContext } from '../../../../../src/logic/execution/rules/types';

test('每个 Agent 只见自己选定的连接器，外部写遵守权限且授权不可重放', async () => {
  const signal = new AbortController().signal;
  let permission: 'read' | 'ask' | 'execute' = 'read';
  let approved = false;
  const approve = vi.fn(async () => approved);
  const call = vi.fn(async () => ({content:[{type:'text',text:'sent'}]}));
  const connector = { List: () => [{name:'cbim_connector_send',inputSchema:{type:'object'}}], Has: (name: string) => name === 'cbim_connector_send', Describe: () => ({native:false,effects:['external-write' as const]}), Call:call };
  const operations = {Inspect:()=>({}), Dispatch:async()=>({})};
  const tools = new OfficeTools('.', 'project', () => permission, operations, signal, approve, connector);
  const other = new OfficeTools('.', 'project', () => permission, operations, signal, approve);
  expect((await other.List()).some(tool => tool.name === 'cbim_connector_send')).toBe(false);
  const request = {id:'read',name:'cbim_connector_send',input:{text:'hello'}};
  expect((await tools.Authorize(request)).allow).toBe(false);
  permission = 'ask';
  expect((await tools.Authorize({...request,id:'ask-deny'})).allow).toBe(false);
  approved = true;
  expect((await tools.Authorize({...request,id:'ask-allow'})).allow).toBe(true);
  expect(await tools.Call(request.name,request.input,signal,'ask-allow')).toEqual({content:[{type:'text',text:'sent'}]});
  expect(await tools.Call(request.name,request.input,signal,'ask-allow')).toMatchObject({isError:true});
  permission = 'execute';
  expect((await tools.Authorize({...request,id:'execute'})).allow).toBe(true);
  permission = 'read';
  expect(await tools.Call(request.name,request.input,signal,'execute')).toMatchObject({isError:true});
  expect(call).toHaveBeenCalledTimes(1);
  expect(approve).toHaveBeenCalledTimes(2);
});

test('Codex 动态工具桥将真实读写和派发路由至同一 Office 权限门禁', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-codex-tools-'));
  let permission: 'read' | 'execute' = 'execute';
  const signal = new AbortController().signal;
  const dispatch = vi.fn(async () => ({ taskId: 'child', status: 'completed' }));
  const office = new OfficeTools(root, 'workspace', () => permission, { Inspect: () => ({ permission }), Dispatch: dispatch }, signal);
  const context: EngineContext = { task: { taskId: 'task', workspaceId: 'workspace', root, mode: 'chat', agentId: 'cbim:main', goal: 'test', acceptance: [], moduleIds: [] }, runId: 'run', directory: root, beforeTool: call => office.Authorize(call), emit: async () => {} };
  const bridge = await codexTools(context, { list: () => office.List(), call: (name, input, stop, id) => office.Call(name, input, stop, id) }, await managedNativeTools(root), true, async () => {});
  try {
    expect(bridge.catalog.map(tool => tool.name)).toEqual(expect.arrayContaining(['cbim_native_read', 'cbim_native_write', 'cbim_native_bash', 'cbim_office_dispatch']));
    expect(await bridge.Call({ callId: 'write', tool: 'cbim_native_write', arguments: { path: 'actual.txt', content: 'written through bridge' } })).toMatchObject({ success: true });
    expect(await fs.readFile(path.join(root, 'actual.txt'), 'utf8')).toBe('written through bridge');
    expect(await bridge.Call({ callId: 'dispatch', tool: 'cbim_office_dispatch', arguments: { memberId: 'writer', workspaceId: 'module', goal: 'task' } })).toMatchObject({ success: true });
    permission = 'read';
    expect(await bridge.Call({ callId: 'denied', tool: 'cbim_native_write', arguments: { path: 'actual.txt', content: 'not allowed' } })).toMatchObject({ success: false });
    expect(await bridge.Call({ callId: 'denied-dispatch', tool: 'cbim_office_dispatch', arguments: { memberId: 'writer', workspaceId: 'module', goal: 'task' } })).toMatchObject({ success: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path.join(root, 'actual.txt'), 'utf8')).toBe('written through bridge');
  } finally {
    bridge.Stop();
    await bridge.Close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('真实文件和命令工具遵循 read、ask、execute，保留拒绝和失败结果', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-tools-'));
  let permission: 'read' | 'ask' | 'execute' = 'read';
  let allow = false;
  const approve = vi.fn(async () => allow);
  const controller = new AbortController();
  const office = new OfficeTools(root, 'w', () => permission, { Inspect: () => ({}), Dispatch: vi.fn() }, controller.signal, approve);
  const native = await managedNativeTools(root);
  let sequence = 0;
  const invoke = async (name: string, input: Record<string, unknown>) => {
    const id = 'call-' + ++sequence;
    const decision = await office.Authorize({ id, name, input });
    return decision.allow ? native.call(name, input, controller.signal, id) : decision;
  };
  try {
    await fs.writeFile(path.join(root, 'seed.txt'), 'seed');
    expect(await invoke('read', { path: 'seed.txt' })).toMatchObject({ content: [{ type: 'text', text: 'seed' }] });
    expect(await invoke('write', { path: 'out.txt', content: 'blocked' })).toMatchObject({ allow: false });
    expect(await invoke('bash', { command: 'echo blocked' })).toMatchObject({ allow: false });
    expect(approve).not.toHaveBeenCalled();
    permission = 'ask';
    expect(await invoke('write', { path: 'out.txt', content: 'denied' })).toMatchObject({ allow: false });
    expect(await fs.access(path.join(root, 'out.txt')).then(() => true, () => false)).toBe(false);
    allow = true;
    await invoke('write', { path: 'out.txt', content: 'approved' });
    expect(await fs.readFile(path.join(root, 'out.txt'), 'utf8')).toBe('approved');
    permission = 'execute';
    const approvals = approve.mock.calls.length;
    await invoke('edit', { path: 'out.txt', edits: [{ oldText: 'approved', newText: 'executed' }] });
    expect(await fs.readFile(path.join(root, 'out.txt'), 'utf8')).toBe('executed');
    await invoke('bash', { command: `node -e "require('fs').writeFileSync('command.txt','ran')"`, timeout: 10 });
    expect(await fs.readFile(path.join(root, 'command.txt'), 'utf8')).toBe('ran');
    const failed = await invoke('bash', { command: 'exit 7', timeout: 10 });
    expect(failed).toMatchObject({ isError: true });
    expect(JSON.stringify(failed)).toMatch(/7/);
    expect(approve.mock.calls.length).toBe(approvals);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('路径越界、知识目录、链接以及未知工具在审批前被拒绝', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-guard-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'office-outside-'));
  const approve = vi.fn(async () => true);
  const office = new OfficeTools(root, 'w', () => 'ask', { Inspect: () => ({}), Dispatch: vi.fn() }, new AbortController().signal, approve);
  try {
    await fs.mkdir(path.join(root, '.cbim'));
    await fs.symlink(outside, path.join(root, 'link'), 'junction');
    for (const value of ['../escape.txt', path.join(outside, 'x'), '.cbim/new/file.json', 'link/new/file.txt'])
      expect(await office.Authorize({ id: value, name: 'write', input: { path: value, content: 'x' } })).toMatchObject({ allow: false });
    expect(await office.Authorize({ id: 'unknown', name: 'arbitrary', input: {} })).toMatchObject({ allow: false });
    expect(approve).not.toHaveBeenCalled();
  } finally {
    await fs.unlink(path.join(root, 'link')).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('审批期间权限降级、取消、派发重放和改参均不能执行', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-grant-'));
  let permission: 'read' | 'ask' | 'execute' = 'ask';
  const dispatch = vi.fn(async () => ({ taskId: 'child', status: 'completed' }));
  const stop = new AbortController();
  const approve = vi.fn(async () => { permission = 'read'; return true; });
  const office = new OfficeTools(root, 'w', () => permission, { Inspect: () => ({}), Dispatch: dispatch }, stop.signal, approve);
  const input = { memberId: 'writer', workspaceId: 'src', goal: 'task', directory: '.' };
  const call = { id: 'dispatch', name: 'cbim_office_dispatch', input };
  try {
    expect(await office.Authorize(call)).toMatchObject({ allow: false });
    permission = 'execute';
    expect(await office.Authorize(call)).toMatchObject({ allow: true });
    expect(await office.Call(call.name, { ...input, goal: 'different' }, stop.signal, call.id)).toMatchObject({ isError: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(await office.Authorize({ ...call, id: 'success' })).toMatchObject({ allow: true });
    expect(await office.Call(call.name, input, stop.signal, 'success')).not.toHaveProperty('isError');
    expect(await office.Call(call.name, input, stop.signal, 'success')).toMatchObject({ isError: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    await office.Authorize({ ...call, id: 'cancel' });
    stop.abort();
    expect(await office.Call(call.name, input, stop.signal, 'cancel')).toMatchObject({ isError: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('主 Agent 用资源工具读写，原生读写和未隔离命令不能操作知识库',async()=>{
 const signal=new AbortController().signal,read=vi.fn(async()=>({revision:0})),write=vi.fn(async()=>({revision:1}));
 const tools=new OfficeTools('.', 'project',()=> 'execute',{Inspect:()=>({}),Dispatch:async()=>({}),ProjectRead:read,ProjectWrite:write},signal);
 for(const name of ['read','edit','write','bash']){
   const input=name==='bash'?{command:'node task.js'}:{path:'.cbim/cability/organization.json'};
   expect((await tools.Authorize({id:name,name,input})).allow).toBe(false);
 }
 const input={resource:'references'};
 expect((await tools.Authorize({id:'r',name:'cbim_project_read',input})).allow).toBe(true);
 await tools.Call('cbim_project_read',input,signal,'r');expect(read).toHaveBeenCalledWith(input);
 expect((await tools.Authorize({id:'invalid',name:'cbim_project_write',input:{resource:'organization',path:'raw.json'}})).allow).toBe(false);
 expect(write).not.toHaveBeenCalled();
});
