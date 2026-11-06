/**
 * 作用定位：定义工作区成员注册、会话绑定及任务派发的原子持久化端口。
 * 设计原因：调度层只表达领域变化，main 负责落盘；任务节点与待投递消息一起提交，观察端口只接收恢复基线及已提交事实。
 * 职责边界：持久化入队不是模型执行，outbox 尚未被执行器消费时不得报告任务正在运行。
 */
import type {AgentInstance, AgentSessionBinding} from '../team/agent-types';
import type {AgentRef, GraphIdentity, GraphEventBatch, GraphSnapshot, GraphCursor, GraphDelta} from './graph-types';

/** 接收成员的任务信封；只保存任务引用，正文从同事务任务节点读取。 */
export interface AssignmentMessage {
  kind: 'assignment'; messageId: string; commandId: string; identity: GraphIdentity;
  from: AgentRef; to: AgentRef; taskId: string; planRevision: number; createdAt: string;
  /** 首版只可靠排队；不把 outbox 保存当作对端确认或执行成功。 */
  delivery: 'pending';
}

/** 工作区级状态；成员跨根会话复用，图与消息按各自根会话隔离。 */
export interface DispatchState {
  workspaceId: string;
  members: AgentInstance[];
  sessions: AgentSessionBinding[];
  graphs: GraphSnapshot[];
  outbox: AssignmentMessage[];
}

/** 幂等键由可信入口产生；fingerprint 是包括调用者在内的规范化输入摘要。 */
export interface DispatchCommand { commandId: string; fingerprint: string }

/** 一个命令的完整提交单元；重复对象 ID 在同次 mutation 中应拒绝。 */
export interface DispatchMutation<T = unknown> {
  members?: AgentInstance[];
  sessions?: AgentSessionBinding[];
  batch?: GraphEventBatch;
  messages?: AssignmentMessage[];
  receipt: T;
}

/**
 * 应用级监控的只读事实接收端；loaded 在完整恢复后调用一次，committed 只对应新落盘事务。
 * 观察失败不能撤回已提交事务，存储通过 failed 单独报告；参数与权威状态隔离，允许接收方持有副本。
 */
export interface DispatchObserver {
  loaded(state: DispatchState): void;
  committed(mutation: DispatchMutation): void;
  failed(error: Error): void;
}

/** 实现必须串行提交且先可靠落盘再返回，不允许失败后发布半次 mutation。 */
export interface DispatchStore {
  /** 内部管理/测试用快照；不得把全工作区成员通道和邮箱经图 IPC 返回。 */
  read(): Promise<DispatchState>;
  /** 相同键和摘要直接返回原回执，不重复执行 prepare；冲突不能覆盖原记录。 */
  transact<T>(command: DispatchCommand, prepare: (state: DispatchState) => Promise<DispatchMutation<T>>): Promise<T>;
  snapshot(identity: GraphIdentity): Promise<GraphSnapshot>;
  delta(identity: GraphIdentity, cursor?: GraphCursor, limit?: number): Promise<GraphDelta>;
  /** 停止接收新操作，等待已排队提交结束后释放资源。 */
  close(): Promise<void>;
}
