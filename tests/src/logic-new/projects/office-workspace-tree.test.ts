import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectList } from '../../../../src/logic-new/projects/project';
import { Paths } from '../../../../src/logic-new/projects/paths';
import { ProjectOffices, type OfficeChat } from '../../../../src/logic-new/projects/offices';

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
    await send();
    expect(JSON.parse(captured[0]).workspaceTree).toEqual({ roots: [], nodes: [] });
    const project = await projects.Open(entry.id);
    project.runtime.project!.UpdateTree({ roots: ['film'], nodes: {
      film: { id: 'film', kind: 'workspace', name: '影片', summary: '制作', children: ['shot'], sources: [] },
      shot: { id: 'shot', kind: 'workspace', name: '镜头', summary: '动画验收', children: [], sources: [] },
    } });
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
