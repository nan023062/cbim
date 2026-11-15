/**
 * 作用定位：生成模型公开运行快照的纯校验，供引擎角色绑定与岗位历史共同使用。
 * 设计原因：与设置的 trim/default 行为分离，历史字段缺省及字节不能在读取时被改写；此处不拥有引擎身份或凭据。
 */
import {z} from 'zod';
const uuid=z.string().uuid();
const text=(max:number)=>z.string().min(1).max(max).refine(value=>!!value.trim(),'文本不能为空白');
const endpoint=z.string().max(4096).url().refine(value=>{try{const url=new URL(value);return value.trim()===value&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))}catch{return false}},'模型地址不能包含凭据、查询或片段');
/** 未附引擎字段的历史生成快照，供组合 schema 保持旧字段顺序。 */
export const generationSnapshotFields=z.object({id:uuid,name:text(80),api:z.enum(['openai-completions','openai-responses','anthropic-messages']),baseUrl:endpoint,auth:z.enum(['api-key','none']),model:text(160),contextWindow:z.number().int().min(1024).max(2000000),maxTokens:z.number().int().min(64).max(2000000),reasoning:z.boolean(),vision:z.boolean().optional(),outputLimit:z.number().int().min(1).max(2000000).optional(),thinkingLevel:z.enum(['off','minimal','low','medium','high','xhigh']).optional(),workingContextWindow:z.number().int().min(1024).max(2000000).optional(),compactionPercent:z.number().int().min(10).max(95).optional(),pricing:z.object({input:z.number().finite().min(0),output:z.number().finite().min(0),cacheRead:z.number().finite().min(0),cacheWrite:z.number().finite().min(0)}).strict().optional()}).strict();
/** 只核容量交叉约束，不修改输入或追加默认字段。 */
export const checkGenerationSnapshot=(value:z.infer<typeof generationSnapshotFields>,context:z.RefinementCtx)=>{
  if(value.maxTokens>value.contextWindow||value.outputLimit!==undefined&&value.maxTokens>value.outputLimit||value.workingContextWindow!==undefined&&value.workingContextWindow>value.contextWindow)context.addIssue({code:'custom',message:'模型预算超过公开能力上限'});
};
export const generationSnapshotSchema=generationSnapshotFields.superRefine(checkGenerationSnapshot);
