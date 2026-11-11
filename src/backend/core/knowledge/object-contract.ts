/**
 * 作用定位：对象编辑的纯数据契约，定义静态知识操作、预览和提交回执。
 * 设计原因：浏览器表单与主进程共享同一 Schema，不加载对象事务、文件系统或 Node.js 哈希实现。
 * 职责边界：结构解析不执行写入；路径、版本、权限和事务校验仍由 ObjectCrud 及知识服务负责。
 */
import {z} from 'zod';
import {agentModelSelectionSchema} from '../brain/llm/engine';
import type {KnowledgeCommit,Preview} from './types';

const fields={name:z.string().min(1).optional(),summary:z.string().optional(),authors:z.array(z.string()).optional(),capabilities:z.array(z.string()).optional(),limitations:z.array(z.string()).optional(),connectors:z.array(z.string()).optional(),sources:z.array(z.object({location:z.string(),scope:z.string()}).strict()).optional(),purpose:z.string().optional()};
/** Schema 与实际写字段共用定义；模块 name 来自目录 slug，中文显示名写在正文 H1。 */
export const objectDataSchemas={
  agent:z.object({runtime:agentModelSelectionSchema.nullable().optional(),name:fields.name,summary:fields.summary,authors:fields.authors,capabilities:fields.capabilities,limitations:fields.limitations,connectors:fields.connectors}).strict(),
  module:z.object({summary:fields.summary,authors:fields.authors,sources:fields.sources,connectors:fields.connectors}).strict().describe('name 固定为目录 slug，不可在 data 修改；中文模块名写在 body 的一级标题（# 中文名称）。'),
  skill:z.object({name:fields.name,purpose:fields.purpose}).strict(),workflow:z.object({name:fields.name}).strict(),
};
const operationFields={action:z.enum(['create','update','delete']),id:z.string().optional(),parentId:z.string().optional(),slug:z.string().optional(),body:z.string().max(2*1024*1024).optional(),cascade:z.boolean().optional()};
export const objectOperation=z.discriminatedUnion('kind',[
  z.object({...operationFields,kind:z.literal('agent'),data:objectDataSchemas.agent.optional()}).strict(),
  z.object({...operationFields,kind:z.literal('module'),data:objectDataSchemas.module.optional()}).strict(),
  z.object({...operationFields,kind:z.literal('skill'),data:objectDataSchemas.skill.optional()}).strict(),
  z.object({...operationFields,kind:z.literal('workflow'),data:objectDataSchemas.workflow.optional()}).strict(),
]);
/** 对象操作只描述静态知识；不接受已废弃的真人登记或维护确认字段。 */
export type ObjectOperation=z.infer<typeof objectOperation>;
/** 完整事务预览及可提交标识；objects 与输入操作按顺序对应。 */
export interface ObjectPreview extends Preview {planId:string;objects:string[];notice:string}
/** 知识事务回执；空目录清理警告不改变已提交的知识结果。 */
export interface ObjectCommit extends KnowledgeCommit {cleanupWarnings:string[]}
