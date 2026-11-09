/**
 * 作用定位：团队、模块、人员注册表与详情的纯业务输出协议。
 * 设计原因：内置角色与项目角色、实际正文与缺失引用具有不同形状；只严格约束服务字段，保留知识定义和原始人员条目的诊断内容。
 * 职责边界：这些静态查询不表示已创建成员实例、已授权执行或已完成人工维护确认。
 */
import {z} from 'zod';
import {jsonValueSchema,knowledgeJsonObjectSchema,knowledgeContextSchema,knowledgeFileSchema,knowledgeIssueSchema,knowledgeOutputIdSchema} from './tool-output-base';

/** 引用本身可能是错误的 JSON 类型或缺省；缺失原因不能被转换成空的成功正文。 */
const unavailable=z.object({available:z.literal(false),reference:jsonValueSchema.optional(),path:z.string().optional(),reason:z.string().optional()}).strict();
export const knowledgeContentOutputSchema=z.union([
  knowledgeFileSchema.extend({available:z.literal(true)}).strict(),unavailable,
]);
/** 内置正文没有项目文件路径或文件哈希，不能伪造为项目文件引用。 */
const inlineContent=z.object({available:z.literal(true),text:z.string()}).strict();
const context=knowledgeContextSchema.shape;
const registryEntry=z.object({id:knowledgeOutputIdSchema,summary:z.string()}).strict();

export const moduleRegistryOutputSchema=z.object({...context,workspaceRootId:z.literal('.cbim/workspace'),modules:z.array(registryEntry),roots:z.array(z.string()),indexSource:z.literal('current-definitions'),persistedIndexMatches:z.boolean()}).strict();
const workflow=z.object({name:z.string(),reference:z.string(),id:knowledgeOutputIdSchema,owner:knowledgeOutputIdSchema,inherited:z.literal(false),content:knowledgeContentOutputSchema}).strict();
export const moduleGetOutputSchema=z.object({...context,id:knowledgeOutputIdSchema,definition:knowledgeJsonObjectSchema,definitionFile:knowledgeFileSchema,overview:knowledgeContentOutputSchema,workflows:z.array(workflow),workflowScope:z.literal('own-only')}).strict();

/** 内置默认角色公开静态能力说明，不含原生文件位置或动态运行身份。 */
const builtinAgentDefinition=z.object({id:z.literal('cbim:executor'),name:z.string(),source:z.literal('builtin'),summary:z.string(),capabilities:z.array(z.string()),limitations:z.array(z.string()),connectors:z.array(z.string()),authors:z.array(z.string())}).strict();
const registeredAgent=registryEntry.extend({name:z.string(),authors:z.array(z.string()),authorPeople:z.array(jsonValueSchema)}).strict();
export const agentRegistryOutputSchema=z.object({...context,teamRootId:z.literal('.cbim/team'),groups:z.array(z.object({id:knowledgeOutputIdSchema,agents:z.array(registeredAgent)}).strict()),indexSource:z.literal('current-definitions'),persistedIndexMatches:z.boolean(),builtinAgents:z.array(builtinAgentDefinition)}).strict();

const effectiveSkill=z.object({name:z.string(),purpose:z.string(),reference:z.string(),owner:z.string(),scope:z.enum(['agent','team']),id:knowledgeOutputIdSchema,inherited:z.boolean(),content:knowledgeContentOutputSchema}).strict();
const customAgent=z.object({...context,id:knowledgeOutputIdSchema,definition:knowledgeJsonObjectSchema,definitionFile:knowledgeFileSchema,principles:knowledgeContentOutputSchema,skillChain:z.array(z.string()),skillConflicts:z.array(knowledgeIssueSchema),skills:z.array(effectiveSkill),skillSelectionValid:z.boolean()}).strict();
const builtinAgent=z.object({...context,id:z.literal('cbim:executor'),source:z.literal('builtin'),definition:builtinAgentDefinition,principles:inlineContent,skillChain:z.array(z.string()),skillConflicts:z.array(knowledgeIssueSchema),skills:z.array(z.object({id:knowledgeOutputIdSchema,owner:z.string(),inherited:z.literal(true),content:inlineContent}).strict()),skillSelectionValid:z.boolean()}).strict();
export const agentGetOutputSchema=z.union([customAgent,builtinAgent]);
/** Team.people 会原样返回结构不合格的条目；诊断输出不能再次套用有效人员定义并裁剪原事实。 */
export const peopleListOutputSchema=z.object({...context,people:z.array(jsonValueSchema)}).strict();

export type ModuleGetOutput=z.infer<typeof moduleGetOutputSchema>;
export type AgentGetOutput=z.infer<typeof agentGetOutputSchema>;
