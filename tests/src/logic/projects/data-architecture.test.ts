import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectList } from '../../../../src/logic/projects/project';
import { Paths } from '../../../../src/logic/projects/paths';
import { DataArchitecture } from '../../../../src/logic/projects/data-architecture';
import type { DataDefinition } from '../../../../src/logic/projects/data-architecture-contract';

test('数据定义 CRUD 持久化、移动保留身份，验证层级/版本/主键并保护损坏文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'data-architecture-'));
  const paths = new Paths(root);
  let projects = new ProjectList(paths);
  try {
    const repo = path.join(root, 'repo'); await fs.mkdir(repo);
    const entry = await projects.Add(repo);
    let catalog = new DataArchitecture(projects);
    await expect(catalog.Read('missing')).rejects.toThrow('未登记');
    let snapshot = await catalog.Read(entry.id); expect(snapshot).toEqual({ revision: 0, nodes: [] });
    const create = async (definition: DataDefinition) => { snapshot = await catalog.Change(entry.id, { action: 'create', revision: snapshot.revision, definition }); return snapshot.nodes.at(-1)!.id; };
    const domain = await create({ kind: 'domain', parentId: null, name: '销售', summary: '' });
    const entity = await create({ kind: 'entity', parentId: domain, name: '订单', summary: '订单资料' });
    const field = await create({ kind: 'field', parentId: entity, name: 'id', summary: '订单编号', dataType: 'integer', required: true, primaryKey: true });
    await expect(catalog.Change(entry.id, { action: 'delete', revision: 0, id: field })).rejects.toThrow('已更新');
    await expect(catalog.Change(entry.id, { action: 'delete', revision: snapshot.revision, id: entity })).rejects.toThrow('非空');
    await expect(create({ kind: 'field', parentId: domain, name: 'invalid', summary: '', dataType: 'string', required: false, primaryKey: false })).rejects.toThrow('归属无效');
    await expect(create({ kind: 'field', parentId: entity, name: 'invalid', summary: '', dataType: 'string', required: false, primaryKey: true })).rejects.toThrow('主键');
    await expect(create({ kind: 'field', parentId: entity, name: 'ID', summary: '', dataType: 'integer', required: true, primaryKey: true })).rejects.toThrow('同名');
    const subdomain = await create({ kind: 'domain', parentId: domain, name: '子域', summary: '' });
    await expect(catalog.Change(entry.id, { action: 'update', revision: snapshot.revision, id: domain, definition: { kind: 'domain', parentId: subdomain, name: '循环', summary: '' } })).rejects.toThrow('循环');
    await expect(catalog.Change(entry.id, { action: 'update', revision: snapshot.revision, id: field, definition: { kind: 'entity', parentId: null, name: '变类', summary: '' } })).rejects.toThrow('类别');
    snapshot = await catalog.Change(entry.id, { action: 'update', revision: snapshot.revision, id: entity, definition: { kind: 'entity', parentId: null, name: '销售订单', summary: '更新说明' } });
    expect(snapshot.nodes.find(node => node.id === field)).toMatchObject({ parentId: entity, primaryKey: true });
    const otherRepo = path.join(root, 'other'); await fs.mkdir(otherRepo); const other = await projects.Add(otherRepo);
    expect((await catalog.Read(other.id)).nodes).toEqual([]);
    await projects.Close(); projects = new ProjectList(paths); catalog = new DataArchitecture(projects);
    expect(await catalog.Read(entry.id)).toEqual(snapshot);
    const concurrent = await Promise.allSettled([catalog.Change(entry.id, { action: 'delete', revision: snapshot.revision, id: field }), catalog.Change(entry.id, { action: 'delete', revision: snapshot.revision, id: field })]);
    expect(concurrent.filter(result => result.status === 'fulfilled')).lengthOf(1);
    snapshot = await catalog.Read(entry.id); expect(snapshot.nodes.some(node => node.id === field)).toBe(false);
    snapshot = await catalog.Change(entry.id, { action: 'delete', revision: snapshot.revision, id: entity });
    expect(snapshot.nodes.some(node => node.id === entity)).toBe(false);
    await fs.writeFile(path.join(paths.Project(entry.id), 'data-architecture.json'), 'broken');
    await expect(catalog.Read(entry.id)).rejects.toThrow();
    await expect(catalog.Change(entry.id, { action: 'delete', revision: snapshot.revision, id: domain })).rejects.toThrow();
    expect(await fs.readFile(path.join(paths.Project(entry.id), 'data-architecture.json'), 'utf8')).toBe('broken');
  } finally { await projects.Close(); await fs.rm(root, { recursive: true, force: true }); }
});
