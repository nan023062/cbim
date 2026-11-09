/**
 * 作用定位：公开应用级成员、任务、目标周期和已报告用量的只读契约及严格传输校验。
 * 设计原因：界面须区分周期结果与模型轮次；只消费监管投影，不接触日志、角色配置、密钥或全局管理器写入入口。
 */
export type {RuntimeAvailability,RuntimeCursor,RuntimeRead,RuntimeSnapshot,RuntimeWorkspace,RuntimeIssue,RuntimeMember,RuntimeTask,RuntimeDispatchTask,RuntimeLoopTask,RuntimeRun,RuntimeScope,RuntimePressure,RuntimeQueueCounts,RuntimeUsage} from '../../backend/core/runtime/types';
export {runtimeCursorSchema,runtimeScopeSchema,runtimeSnapshotSchema,runtimeReadSchema} from '../../backend/core/runtime/runtime-validation';
