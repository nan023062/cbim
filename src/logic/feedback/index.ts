/**
 * 作用定位：反馈输入、格式化、可信目标和公开连接状态的纯业务入口。
 * 设计原因：工具策略与通信只需业务契约，不加载凭据、文件、网络或原生锁。
 */
export {githubFeedbackScopeSchema,feedbackInputSchema,feedbackResultSchema,feedbackReceiptInputSchema,feedbackConnectionCheckSchema,feedbackAvailabilitySchema,githubFeedbackConfigSchema,feedbackIssue} from './contracts';
export type {FeedbackInput,FeedbackScope,FeedbackResult,FeedbackToolsPort,FeedbackConnectionCheck,FeedbackAvailability,GitHubFeedbackConfig,GitHubFeedbackStatus} from './contracts';
