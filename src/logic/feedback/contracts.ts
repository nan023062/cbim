/**
 * 作用定位：CBIM 反馈 Skill、可信 GitHub 端口和桌面登录共用的纯协议。
 * 设计原因：模型只填写用户提供的业务上下文；账号、仓库和自动提交授权由本机设置绑定，凭据不进入工具或公开设置。只读诊断将连接事实与本轮工具装配分开，不授予提交权限。
 * 内容边界：仅简述必填，补充字段允许缺省或空白；确定性正文标记“用户未提供”，不编造事实，已填写完整的旧正文保持不变。
 */
import {z} from 'zod';
/** 可信装配绑定的反馈目标；字段与原日志协议保持一致，不携带凭据或签发权限。 */
export const githubFeedbackScopeSchema=z.object({kind:z.literal('github-feedback'),workspaceId:z.string(),connectionId:z.string().uuid(),repositoryId:z.number().int().positive(),owner:z.string().min(1).max(100),repo:z.string().min(1).max(100)}).strict();

const field=z.string().min(1).max(6000).refine(value=>value.trim().length>0&&!value.includes('<!-- cbim-feedback:'),'内容为空或包含保留标记');
const optionalField=z.string().max(6000).refine(value=>!value.includes('<!-- cbim-feedback:'),'内容包含保留标记').optional().describe('可选，仅填写用户愿意提供的内容；省略或空白显示用户未提供，不为缺项追问');
const common={summary:field.refine(value=>value.length<=180,'标题过长').describe('用户愿意提交的问题或愿望简述，不能为空'),extra:optionalField};
/** 只有类型与简述必需；保留严格字段、长度和保留标记限制，缺项不形成补全门槛。 */
export const feedbackInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('bug'),...common,steps:optionalField,actual:optionalField,expected:optionalField,environment:optionalField}).strict(),
  z.object({kind:z.literal('wish'),...common,scenario:optionalField,problem:optionalField,expected:optionalField,example:optionalField}).strict(),
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

/** 本机连接检查只读公开状态与代际，不请求 GitHub、不解密令牌、不查询提交历史。 */
export const feedbackConnectionCheckSchema=z.object({
  code:z.enum(['GITHUB_CONNECTED','GITHUB_NOT_CONNECTED','GITHUB_AUTH_PENDING','GITHUB_CONNECTION_CHANGED','GITHUB_EXPIRED','GITHUB_SECRET_STORAGE','GITHUB_SETTINGS']),
  repository:z.object({owner:z.string().min(1).max(100),repo:z.string().min(1).max(100)}).strict().optional(),
}).strict();
export type FeedbackConnectionCheck=z.infer<typeof feedbackConnectionCheckSchema>;
/** 只描述当前运行可用性；READY 不等于网络可达或提交成功，两项操作始终成对装配。 */
export const feedbackAvailabilitySchema=z.object({
  code:z.enum(['FEEDBACK_READY','FEEDBACK_TOOL_NOT_LOADED','FEEDBACK_NEW_TURN_REQUIRED','GITHUB_NOT_CONNECTED','GITHUB_AUTH_PENDING','GITHUB_CONNECTION_CHANGED','GITHUB_EXPIRED','GITHUB_SECRET_STORAGE','GITHUB_SETTINGS']),
  submitAvailable:z.boolean(),receiptAvailable:z.boolean(),
  repository:z.object({owner:z.string().min(1).max(100),repo:z.string().min(1).max(100)}).strict().optional(),
  message:z.string().min(1).max(600),
}).strict().refine(value=>value.submitAvailable===value.receiptAvailable,'反馈提交与核实工具必须成对装配');
export type FeedbackAvailability=z.infer<typeof feedbackAvailabilitySchema>;

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
/** 缺省/空白的主栏目统一标记未提供，保证等价输入防重；完整旧输入输出不变。不读取额外资料。 */
export function feedbackIssue(input:FeedbackInput){
  const fields: [string,string|undefined][] = input.kind==='bug'
    ?[['问题',input.summary],['复现步骤',input.steps],['实际结果',input.actual],['预期结果',input.expected],['环境',input.environment]]
    :[['需求',input.summary],['使用场景',input.scenario],['当前困难',input.problem],['期望能力',input.expected],['使用例子',input.example]];
  if(input.extra?.trim())fields.push(['补充上下文',input.extra]);
  return {title:`[${input.kind==='bug'?'BUG':'需求'}] ${input.summary.replace(/\s+/g,' ').trim()}`,body:fields.map(([label,value])=>`## ${label}\n\n${value?.trim()||'用户未提供'}`).join('\n\n')};
}
