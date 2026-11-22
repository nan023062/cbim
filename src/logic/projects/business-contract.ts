/**
 * 作用定位：业务树编辑的纯契约，节点身份独立于目录路径；来源仅为资料，不授予文件访问权。
 * 设计原因：稳定节点身份和资料来源分开建模，结构编辑不能转化为文件系统授权。
 */
import { z } from 'zod';
import { marketSource } from './market-source';

const workflowDefinition = z.object({ name: z.string().trim().min(1).max(100), reference: z.string().trim().min(1).max(2048), logo: z.string().max(132000).optional() }).strict();

const identity = z.string().min(1).max(2048);

export const businessDefinitionSchema = z.object({ parentId: identity.nullable(), name: z.string().trim().min(1).max(160), summary: z.string().trim().max(4000), sources: z.array(z.object({ location: z.string().trim().min(1).max(2048), scope: z.string().trim().max(4000) }).strict()).max(100), virtual: z.boolean(), workflows: z.array(workflowDefinition).max(32).optional() }).strict();

export const businessSnapshotSchema = z.object({ revision: z.number().int().nonnegative(), nodes: z.array(businessDefinitionSchema.extend({ id: identity, market: marketSource.optional() })).max(2000) }).strict().superRefine((value, context) => { const nodes = new Map(value.nodes.map(node => [node.id, node])); const names = new Set<string>(); if (nodes.size !== value.nodes.length) context.addIssue({ code: 'custom', message: '业务节点身份重复' }); for (const node of value.nodes) { const key = JSON.stringify([node.parentId, node.name.toLowerCase()]); if (names.has(key)) context.addIssue({ code: 'custom', message: '同层级业务节点重名' }); names.add(key); const seen = new Set([node.id]); let parent = node.parentId; while (parent !== null) { const ancestor = nodes.get(parent); if (!ancestor || seen.has(parent) || seen.size >= 64) { context.addIssue({ code: 'custom', message: '业务归属无效、循环或层级过深' }); break; } seen.add(parent); parent = ancestor.parentId; } } });

export const businessChangeSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('create'), revision: z.number().int().nonnegative(), definition: businessDefinitionSchema }).strict(), z.object({ action: z.literal('update'), revision: z.number().int().nonnegative(), id: identity, definition: businessDefinitionSchema }).strict(), z.object({ action: z.literal('delete'), revision: z.number().int().nonnegative(), id: identity }).strict()]);

export type BusinessSnapshot = z.infer<typeof businessSnapshotSchema>;

export type BusinessChange = z.infer<typeof businessChangeSchema>;
