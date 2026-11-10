/**
 * 作用定位：团队、模块注册表与详情的纯业务输出协议。
 * 设计原因：内置项目根与角色没有磁盘文件，必须与正式定义区分；模块查询 v2 明确根范围，不伪造文件，保留知识定义，兼容旧 authorPeople 空字段。
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

const projectRoot=z.object({id:z.literal('cbim:project'),name:z.string(),source:z.literal('builtin'),summary:z.string(),children:z.array(z.string())}).strict();
/** 内置根范围独立于磁盘派生索引；它不会伪造正式 Module 文件或维护确认。 */
export const moduleRegistryOutputSchema=z.object({...context,workspaceRootId:z.literal('.cbim/workspace'),projectRoot,modules:z.array(registryEntry),roots:z.array(z.string()),indexSource:z.literal('current-definitions'),persistedIndexMatches:z.boolean()}).strict();
const workflow=z.object({name:z.string(),reference:z.string(),id:knowledgeOutputIdSchema,owner:knowledgeOutputIdSchema,inherited:z.literal(false),content:knowledgeContentOutputSchema}).strict();
const storedModule=z.object({...context,id:knowledgeOutputIdSchema,definition:knowledgeJsonObjectSchema,definitionFile:knowledgeFileSchema,overview:knowledgeContentOutputSchema,workflows:z.array(workflow),workflowScope:z.literal('own-only')}).strict();
const rootModule=z.object({...context,id:z.literal('cbim:project'),source:z.literal('builtin'),definition:projectRoot.extend({workflows:z.array(z.never())}).strict(),overview:inlineContent,workflows:z.array(z.never()),workflowScope:z.literal('own-only')}).strict();
export const moduleGetOutputSchema=z.union([storedModule,rootModule]);

/** 仅公开自定义能力；默认主角色隐式存在，退役默认执行者不再属于可查询的静态角色。 */
const registeredAgent=registryEntry.extend({name:z.string(),authors:z.array(z.string()),authorPeople:z.array(jsonValueSchema)}).strict();
export const agentRegistryOutputSchema=z.object({...context,teamRootId:z.literal('.cbim/team'),groups:z.array(z.object({id:knowledgeOutputIdSchema,agents:z.array(registeredAgent)}).strict()),indexSource:z.literal('current-definitions'),persistedIndexMatches:z.boolean(),builtinAgents:z.array(z.never())}).strict();

const effectiveSkill=z.object({name:z.string(),purpose:z.string(),reference:z.string(),owner:z.string(),scope:z.enum(['agent','team']),id:knowledgeOutputIdSchema,inherited:z.boolean(),content:knowledgeContentOutputSchema}).strict();
const customAgent=z.object({...context,id:knowledgeOutputIdSchema,definition:knowledgeJsonObjectSchema,definitionFile:knowledgeFileSchema,principles:knowledgeContentOutputSchema,skillChain:z.array(z.string()),skillConflicts:z.array(knowledgeIssueSchema),skills:z.array(effectiveSkill),skillSelectionValid:z.boolean()}).strict();
export const agentGetOutputSchema=customAgent;

export type ModuleGetOutput=z.infer<typeof moduleGetOutputSchema>;
export type AgentGetOutput=z.infer<typeof agentGetOutputSchema>;
