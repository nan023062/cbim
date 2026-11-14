/**
 * 作用定位：设置界面的 GitHub 公开连接协议与输入 Schema。
 * 设计原因：迁移期仅具名转接纯配置契约，不公开提交服务、令牌、device_code 或原提交记录。
 */
export {githubFeedbackConfigSchema} from '../../logic/feedback';
export type {GitHubFeedbackConfig,GitHubFeedbackStatus} from '../../logic/feedback';
