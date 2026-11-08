/**
 * 作用定位：CBIM 反馈 Skill、可信 GitHub 端口和桌面登录共用的纯协议。
 * 设计原因：模型只填写用户提供的业务上下文；账号、仓库和自动提交授权由本机设置绑定，凭据不进入工具或公开设置。
 */
import {z} from 'zod';
import {githubFeedbackScopeSchema} from '../tools/scope-schema';

const field=z.string().min(1).max(6000).refine(value=>value.trim().length>0&&!value.includes('<!-- cbim-feedback:'),'内容为空或包含保留标记');
const common={summary:field.refine(value=>value.length<=180,'标题过长'),extra:field.optional()};
/** 必填项缺失时由 Skill 继续收集，不由网络层编造默认事实。 */
export const feedbackInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('bug'),...common,steps:field,actual:field,expected:field,environment:field}).strict(),
  z.object({kind:z.literal('wish'),...common,scenario:field,problem:field,expected:field,example:field}).strict(),
]);
export type FeedbackInput=z.infer<typeof feedbackInputSchema>;
export type FeedbackScope=z.infer<typeof githubFeedbackScopeSchema>;
export const feedbackResultSchema=z.object({status:z.literal('submitted'),operationId:z.string().uuid()}).strict();
export type FeedbackResult=z.infer<typeof feedbackResultSchema>;
export const feedbackReceiptInputSchema=z.object({}).strict();
/** 只向桌面主会话装配；receipt 核实当前工作区唯一待核实提交，或本会话最近提交，不查询开发处理进度。 */
export interface FeedbackToolsPort {
  readonly scope:FeedbackScope;
  submit(input:FeedbackInput,signal:AbortSignal):Promise<FeedbackResult>;
  receipt(signal:AbortSignal):Promise<FeedbackResult>;
}

export const githubFeedbackConfigSchema=z.object({
  clientId:z.string().regex(/^[A-Za-z0-9_.-]{6,100}$/),
  owner:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
  repo:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine(value=>value!=='.'&&value!=='..'),
  visibility:z.enum(['public','private']),
  /** 桌面连接按钮同时明确授予该仓库的反馈自动提交；不是模型参数。 */
  autoSubmit:z.literal(true),
}).strict();
export type GitHubFeedbackConfig=z.infer<typeof githubFeedbackConfigSchema>;
/** 只含公开登录信息；device_code、token、原 Issue 链接及提交正文均不公开。 */
export interface GitHubFeedbackStatus {
  secureStorage:boolean;
  config:Omit<GitHubFeedbackConfig,'autoSubmit'>;
  connected?:{login:string;owner:string;repo:string};
  flow?:{id:string;userCode:string;verificationUri:'https://github.com/login/device';expiresAt:number;nextPollAt:number};
}
/** 确定性正文仅包含本次格式字段；不遍历工程、会话、环境变量或附件目录。 */
export function feedbackIssue(input:FeedbackInput){
  const fields: [string,string][] = input.kind==='bug'
    ?[['问题',input.summary],['复现步骤',input.steps],['实际结果',input.actual],['预期结果',input.expected],['环境',input.environment]]
    :[['需求',input.summary],['使用场景',input.scenario],['当前困难',input.problem],['期望能力',input.expected],['使用例子',input.example]];
  if(input.extra)fields.push(['补充上下文',input.extra]);
  return {title:`[${input.kind==='bug'?'BUG':'需求'}] ${input.summary.replace(/\s+/g,' ').trim()}`,body:fields.map(([label,value])=>`## ${label}\n\n${value.trim()}`).join('\n\n')};
}
