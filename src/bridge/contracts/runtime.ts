/**
 * 作用定位：公开应用级成员、任务负载和运行用量的可序列化观察契约。
 * 设计原因：界面只消费监管投影，不接触工作区日志、角色配置、模型密钥或全局管理器的写入入口。
 */
export type {RuntimeCursor,RuntimeRead,RuntimeSnapshot} from '../../backend/core/runtime/types';
