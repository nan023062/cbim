/**
 * 作用定位：对话、运行和排队在 IPC 中传递的可序列化类型。
 * 设计原因：界面通过协议入口消费 Core 数据，不导入带文件操作的调度实现。
 */
export type {RunSummary,StoredEvent,EngineEvent} from '../../backend/core/brain/types';
export type {TaskSpec} from '../../backend/core/tasks/types';
export type {QueuedMessage,QueueCursor,QueueDelta} from '../../backend/core/tasks/queue';
export type {PendingQuestion,QuestionInput} from '../../backend/core/tools/questions';
