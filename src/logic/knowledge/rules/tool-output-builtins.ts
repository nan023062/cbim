/**
 * 作用定位：内置资料目录、正文以及 Skill 别名工具共享的业务输出协议。
 * 设计原因：版本、只读来源和引用状态由真实白名单服务产生；结构化返回不把资料读取包装成已执行 Skill 或可访问任意文件的能力。
 */
import {z} from 'zod';
import {knowledgeOutputIdSchema,knowledgeOutputHashSchema} from './tool-output-base';

const entry=z.object({id:knowledgeOutputIdSchema,kind:z.enum(['skill','standard','schema']),title:z.string(),source:knowledgeOutputIdSchema,version:knowledgeOutputHashSchema,readOnly:z.literal(true)}).strict();
const referenceBase={reference:z.string(),anchor:z.string().optional()};
/** 缺少目标 ID 的外部、同文档及未解析引用仍是明确结果，不推断为可读取内置资料。 */
const reference=z.discriminatedUnion('status',[
  z.object({...referenceBase,status:z.literal('available'),id:knowledgeOutputIdSchema}).strict(),
  z.object({...referenceBase,status:z.literal('same_document')}).strict(),
  z.object({...referenceBase,status:z.literal('external')}).strict(),
  z.object({...referenceBase,status:z.literal('unavailable')}).strict(),
]);
export const builtinCatalogOutputSchema=z.object({entryId:knowledgeOutputIdSchema,contract:z.string(),revision:knowledgeOutputHashSchema,items:z.array(entry)}).strict();
export const builtinReadOutputSchema=entry.extend({text:z.string(),contract:z.string(),references:z.array(reference)}).strict();
export type BuiltinCatalogOutput=z.infer<typeof builtinCatalogOutputSchema>;
export type BuiltinReadOutput=z.infer<typeof builtinReadOutputSchema>;
