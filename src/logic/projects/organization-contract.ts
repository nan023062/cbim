/**
 * 作用定位：组织编辑只改变节点资料和归属，能力配置由 AgentSettings 独立管理。
 * 设计原因：组织资料编辑与 Agent 能力设置分开校验，节点移动不隐式改变模型或账号。
 */
import { z } from 'zod';
import { marketSource } from './market-source';

import { agentConfigurationSchema } from './agent-configuration';

const identity = z.string().min(1).max(2048);

const name = z.string().trim().min(1).max(160);

const teamSkills = agentConfigurationSchema.innerType().shape.skills.optional();

const position = z.string().trim().max(4000);

export const organizationNodeSchema = z.object({ id: identity, kind: z.enum(['team', 'agent']), parentId: identity.nullable(), name, position, teamSkills, market: marketSource.optional(), configuration: agentConfigurationSchema.optional() }).strict();

export const organizationSnapshotSchema = z.object({ revision: z.number().int().nonnegative(), nodes: z.array(organizationNodeSchema).max(2000) }).strict().superRefine((value, context) => { const nodes = new Map(value.nodes.map(node => [node.id, node])); if (nodes.size !== value.nodes.length) context.addIssue({ code: 'custom', message: '组织节点身份重复' }); for (const node of value.nodes) { const seen = new Set([node.id]); let parent = node.parentId; while (parent !== null) { const ancestor = nodes.get(parent); if (!ancestor || ancestor.kind !== 'team' || seen.has(parent) || seen.size >= 64) { context.addIssue({ code: 'custom', message: '组织归属无效、层级过深或存在循环' }); break; } seen.add(parent); parent = ancestor.parentId; } } });

export const organizationChangeSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('create'), revision: z.number().int().nonnegative(), kind: z.enum(['team', 'agent']), parentId: identity.nullable(), name, position, teamSkills }).strict(), z.object({ action: z.literal('update'), revision: z.number().int().nonnegative(), id: identity, parentId: identity.nullable(), name, position, teamSkills }).strict(), z.object({ action: z.literal('delete'), revision: z.number().int().nonnegative(), id: identity }).strict(),]);

export type OrganizationNode = z.infer<typeof organizationNodeSchema>;

export type OrganizationSnapshot = z.infer<typeof organizationSnapshotSchema>;

export type OrganizationChange = z.infer<typeof organizationChangeSchema>;
