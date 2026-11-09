/**
 * 作用定位：设置界面的 GitHub 公开连接协议。
 * 设计原因：只转接纯类型，不让前端导入主进程服务或获得令牌、device_code 和原提交记录。
 */
export type {GitHubFeedbackConfig,GitHubFeedbackStatus} from '../../backend/core/connectors/github-feedback';
