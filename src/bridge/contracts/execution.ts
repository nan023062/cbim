/**
 * 作用定位：对话、运行和排队在 IPC 中传递的可序列化类型。
 * 设计原因：界面通过协议消费 Core 数据，不导入文件操作；历史损坏以独立问题呈现，可续聊头由后端核实，不能从剩余可读记录猜测。
 */
export type {RunSummary,StoredEvent,EngineEvent,ConversationThreadView} from '../../backend/core/brain/types';
export type {TaskSpec} from '../../backend/core/tasks/types';
export type {QueuedMessage,QueueCursor,QueueDelta} from '../../backend/core/tasks/queue';
export type {PendingQuestion,QuestionInput} from '../../backend/core/tools/questions';
