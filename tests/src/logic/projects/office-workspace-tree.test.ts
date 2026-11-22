import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectList } from '../../../../src/logic/projects/project';
import { Paths } from '../../../../src/logic/projects/paths';
import { ProjectOffices, type OfficeChat } from '../../../../src/logic/projects/offices';
import { readProjectResources } from '../../../../src/logic/projects/resources';

test('岗位模型必须明确配置，完整配置可派发，未配置不暗中继承主模型', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-roles-'));
  try {
    const directory = path.join(root, '.cbim', 'team', 'writer');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'agent.json');
    await fs.writeFile(file, JSON.stringify({ name: 'Writer', summary: 'Implementation' }));
    expect((await readProjectResources('project', root)).organization[0]).toMatchObject({ available: false });
    await fs.writeFile(file, JSON.stringify({ name: 'Writer', summary: 'Implementation', model: { engine: 'codex', profileId: 'profile', modelId: 'model' } }));
    expect((await readProjectResources('project', root)).organization[0]).toMatchObject({ available: true, model: { engine: 'codex', profileId: 'profile', modelId: 'model' } });
    await fs.writeFile(file, JSON.stringify({ name: 'Writer', summary: 'Implementation', model: { engine: 'codex' } }));
    await expect(readProjectResources('project', root)).rejects.toThrow('配置不完整');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('界面提交的三种权限通过主 Agent 工厂传入 OfficeChat，读取器跟随 Office 变更', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-permission-'));
  const projects = new ProjectList(new Paths(root));
  const readers: Array<Parameters<OfficeChat>[4]['ReadPermission']> = [];
  const values: string[] = [];
  const offices = new ProjectOffices(projects, async (_role, _messages, _signal, _progress, turn) => {
    readers.push(turn.ReadPermission);
    values.push(turn.ReadPermission());
    return { text: '收到', metrics: { elapsed: 1, model: 'fixture', capacity: 8192 } };
  });
  try {
    const directory = path.join(root, 'project');
    await fs.mkdir(directory);
    const entry = await projects.Add(directory);
    const { id } = await offices.Open(entry.id, 'create');
    for (const permission of ['read', 'ask', 'execute'] as const)
      await offices.Send(entry.id, id, '检查权限', undefined, permission, { engine: 'pi', profileId: 'local', modelId: 'fixture' });
    expect(values).toEqual(['read', 'ask', 'execute']);
    const project = await projects.Open(entry.id);
    project.runtime.OpenOffice(entry.id, id).permission = 'read';
    expect(readers.map(read => read())).toEqual(['read', 'read', 'read']);
  } finally {
    await projects.Close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('每轮读取所属项目当前的树，并仅将用户原文写入历史', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-tree-'));
  const projects = new ProjectList(new Paths(root));
  const captured: string[] = [];
  const chat: OfficeChat = async (_role, messages) => {
    captured.push(messages.at(-1)!.content);
    return { text: '收到', metrics: { elapsed: 1, model: 'fixture', capacity: 8192 } };
  };
  const offices = new ProjectOffices(projects, chat);
  try {
    const directory = path.join(root, 'animation');
    await fs.mkdir(directory);
    const entry = await projects.Add(directory);
    const { id } = await offices.Open(entry.id, 'create');
    const send = () => offices.Send(entry.id, id, '检查镜头', undefined, 'read', { engine: 'pi', profileId: 'local', modelId: 'fixture' });
    expect(await projects.Business(entry.id)).toEqual({roots:[],nodes:[]});
    await send();
    expect(JSON.parse(captured[0]).workspaceTree).toEqual({ roots: [], nodes: [] });
    const project = await projects.Open(entry.id);
    project.runtime.project!.UpdateTree({ roots: ['film'], nodes: {
      film: { id: 'film', kind: 'workspace', name: '影片', summary: '制作', children: ['shot'], sources: [] },
      shot: { id: 'shot', kind: 'workspace', name: '镜头', summary: '动画验收', children: [], sources: [{location:'src/shots',scope:'animation'}] },
    } });
    const updated=await projects.Business(entry.id);
    await project.trees.SaveBusiness({revision:1,nodes:updated.nodes.map(n=>({id:n.id,name:n.name,summary:n.summary,virtual:n.virtual,sources:n.sources,parentId:updated.nodes.find(parent=>parent.children.includes(n.id))?.id??null}))});
    const snapshot = await projects.Business(entry.id);
    expect(snapshot.nodes.find(node => node.id === 'shot')).toMatchObject({name:'镜头',sources:[{location:'src/shots',scope:'animation'}],virtual:false});
    snapshot.nodes[0].children.length = 0;
    snapshot.nodes[1].sources[0].scope = 'mutated';
    expect((await projects.Business(entry.id)).nodes[0].children).toEqual(['shot']);
    expect((await projects.Business(entry.id)).nodes[1].sources[0].scope).toBe('animation');
    await expect(projects.Business('unknown')).rejects.toThrow('未登记');
    const messages = await send();
    const goal = JSON.parse(captured[1]);
    expect(goal.userRequest).toBe('检查镜头');
    expect(goal.workspaceTree.roots).toEqual(['film']);
    expect(goal.workspaceTree.nodes.map((n: { id: string; children: string[] }) => [n.id,n.children])).toEqual([['film',['shot']],['shot',[]]]);
    expect(messages.find(m => m.role === 'user')?.text).toBe('检查镜头');
  } finally {
    await projects.Close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
