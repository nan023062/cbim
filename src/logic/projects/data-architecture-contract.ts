/** Logic 纯契约：数据目录的定义与结构约束，不包含数据库连接或记录操作。 */
import { z } from 'zod';

/** 节点编辑资料；字段约束仅对字段节点生效。 */
export const dataDefinitionSchema = z.object({ kind: z.enum(['domain', 'entity', 'field']), parentId: z.string().min(1).max(160).nullable(), name: z.string().trim().min(1).max(160), summary: z.string().trim().max(4000), dataType: z.enum(['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'json', 'binary']).optional(), required: z.boolean().optional(), primaryKey: z.boolean().optional() }).strict();

/** 存储节点保留不可变身份。 */
export const dataNodeSchema = dataDefinitionSchema.extend({ id: z.string().min(1).max(160) });

/** 完整快照同时核验层级、重复名称和字段约束，损坏数据不能被覆盖。 */
export const dataArchitectureSchema = z.object({ revision: z.number().int().nonnegative(), nodes: z.array(dataNodeSchema).max(2000) }).strict().superRefine((value, context) => { const nodes = new Map(value.nodes.map(node => [node.id, node])); const names = new Set<string>(); const fail = (message: string) => context.addIssue({ code: 'custom', message }); if (nodes.size !== value.nodes.length) fail('数据节点身份重复'); for (const node of value.nodes) { const key = JSON.stringify([node.parentId, node.name.toLowerCase()]); if (names.has(key)) fail('同一层级存在同名节点'); names.add(key); const parent = node.parentId === null ? undefined : nodes.get(node.parentId); if (node.parentId !== null && !parent || node.kind === 'field' && parent?.kind !== 'entity' || node.kind !== 'field' && parent && parent.kind !== 'domain') fail('归属无效：字段必须属于实体，数据域和实体只能属于数据域或顶层'); if (node.kind === 'field') { if (!node.dataType || typeof node.required !== 'boolean' || typeof node.primaryKey !== 'boolean') fail('字段类型与约束不完整'); if (node.primaryKey && !node.required) fail('主键字段必须为必填'); } else if (node.dataType !== undefined || node.required !== undefined || node.primaryKey !== undefined) fail('只有字段可以定义类型与约束'); const seen = new Set([node.id]); let ancestor = parent; while (ancestor) { if (seen.has(ancestor.id) || seen.size >= 64) { fail('数据层级存在循环或超过 64 层'); break; } seen.add(ancestor.id); ancestor = ancestor.parentId === null ? undefined : nodes.get(ancestor.parentId); } } });

/** 修改只接收单个节点资料及预期版本，不能指定文件路径或执行数据库语句。 */
export const dataArchitectureChangeSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('create'), revision: z.number().int().nonnegative(), definition: dataDefinitionSchema }).strict(), z.object({ action: z.literal('update'), revision: z.number().int().nonnegative(), id: z.string().min(1).max(160), definition: dataDefinitionSchema }).strict(), z.object({ action: z.literal('delete'), revision: z.number().int().nonnegative(), id: z.string().min(1).max(160) }).strict()]);

export type DataDefinition = z.infer<typeof dataDefinitionSchema>;

export type DataArchitectureNode = z.infer<typeof dataNodeSchema>;

export type DataArchitectureSnapshot = z.infer<typeof dataArchitectureSchema>;

export type DataArchitectureChange = z.infer<typeof dataArchitectureChangeSchema>;
