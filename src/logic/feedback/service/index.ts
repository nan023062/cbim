/**
 * 作用定位：反馈服务的宿主入口，公开授权管理与有持久屏障的提交服务。
 * 设计原因：Main 装配实例与生命周期；纯协议不加载本入口，令牌与账本不向 Bridge/View 公开。
 */
export {GitHubFeedback} from './github-feedback';
export {GitHubFeedbackAuth} from './github-feedback-auth';
export type {GitHubRequest,GitHubReply} from './github-api';
