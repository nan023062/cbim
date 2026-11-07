/**
 * 作用定位：定义工作区长期岗位登记、执行实例、会话绑定及任务派发的原子持久化端口。
 * 设计原因：调度层只表达领域变化，main 负责落盘；任务、领取意图、消息和成员占用一起提交，界面在同一屏障读取图与独立周期投影，观察端口只接收已提交事实。
 * 职责边界：长期岗位只经独立审计追加，不创建执行实例；持久化入队或 starting 意图都不是模型已经运行，确认候选、问题或检查点均不代表验收或续执行授权。
 */
import type {AgentInstance, AgentSessionBinding} from '../team/agent-types';
import type {AgentRef, GraphIdentity, GraphEventBatch, GraphSnapshot, GraphCursor, GraphDelta} from './graph-types';
import type {DispatchRun} from './dispatch-execution';
import type {DispatchScope} from './dispatch-scope';
import type {DispatchSessionReadInput,DispatchSessionRead} from './scope-view';
import type {MemberResumeFrom} from './member-checkpoint';
import type {WorkspaceMember,WorkspaceMemberChange,WorkspaceRegistryCursor} from '../team/workspace-member';

/** 信封身份固定；claim 记录领取时的 run 与租约代际，消费后保留用于审计。 */
export interface DispatchMessageBase {
  messageId: string; commandId: string; identity: GraphIdentity;
  from: AgentRef; to: AgentRef; taskId: string; planRevision: number; createdAt: string;
  /** assignment 按 pending→claimed→processed 前进；result 只经可信确认从 pending 变为 processed。 */
  delivery: 'pending'|'claimed'|'processed';
  /** 仅 assignment 被领取时生成，消费后继续保留；result 不创建运行或领取租约。 */
  claim?:{runId:string;leaseEpoch:number};
}
/** 接收成员的任务信封；只保存任务引用，正文从同事务任务节点读取。 */
export interface AssignmentMessage extends DispatchMessageBase {kind:'assignment';resumeFrom?:MemberResumeFrom}
/** 返回原发送方的候选引用；不复制消息正文，也不形成任务图的反向边。 */
export interface ResultMessage extends DispatchMessageBase {kind:'result';replyTo:string;resultId:string;runId:string}
/** 成员正常结算后的问题引用，不是成功候选、用户消息或自动恢复许可。 */
export interface HelpMessage extends DispatchMessageBase {kind:'help';replyTo:string;helpId:string;runId:string}
/** 检查点可供主调度审阅，不是成功结果或自动恢复许可；只在可靠正常结算时发出。 */
export interface CheckpointMessage extends DispatchMessageBase {kind:'checkpoint';replyTo:string;checkpointId:string;runId:string}
export type DispatchMessage=AssignmentMessage|ResultMessage|HelpMessage|CheckpointMessage;

/** 工作区级状态；主实例随会话保留，周期执行实例与历史图分开计量。 */
export interface DispatchState {
  workspaceId: string;
  members: AgentInstance[];
  sessions: AgentSessionBinding[];
  graphs: GraphSnapshot[];
  outbox: DispatchMessage[];
  /** 旧版本内存 fixture 可缺省；真实存储读取始终返回数组，旧日志按空集合恢复。 */
  runs?:DispatchRun[];
  /** 旧日志没有周期；按空集合恢复，不把旧任务伪造为新周期。 */
  scopes?:DispatchScope[];
  /** 长期岗位与 members 执行实例分离；旧日志缺省为空，不从既有运行猜测岗位。 */
  workspaceMembers?:WorkspaceMember[];
  /** 当前 head 从这些不可变登记事件派生；无第二份登记文件。 */
  workspaceMemberChanges?:WorkspaceMemberChange[];
  /** 未发生登记为 null/旧缺省，首次登记后由独立流推进；图及周期游标不受影响。 */
  registryCursor?:WorkspaceRegistryCursor|null;
}

/** 幂等键由可信入口产生；fingerprint 是包括调用者在内的规范化输入摘要。 */
export interface DispatchCommand { commandId: string; fingerprint: string }

/** 一个命令的完整提交单元；可选数组按对象 ID 写入完整新记录，省略不改变集合，重复 ID 须拒绝。 */
export interface DispatchMutation<T = unknown> {
  members?: AgentInstance[];
  sessions?: AgentSessionBinding[];
  batch?: GraphEventBatch;
  messages?: DispatchMessage[];
  runs?:DispatchRun[];
  scopes?:DispatchScope[];
  /** 本片每次恰好追加一条岗位审计，禁止同批混入任务、实例或周期修改。 */
  workspaceMemberChanges?:WorkspaceMemberChange[];
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
  /** 只查已提交原命令；共享提交屏障，返回隔离副本，不调用 prepare 或重新执行操作。 */
  commandReceipt(commandId:string):Promise<{fingerprint:string;receipt:unknown}|undefined>;
  /** 相同键和摘要直接返回原回执，不重复执行 prepare；冲突不能覆盖原记录。 */
  transact<T>(command: DispatchCommand, prepare: (state: DispatchState) => Promise<DispatchMutation<T>>): Promise<T>;
  /** 读取指定主会话的已提交图；尚未建图应报 GRAPH_NOT_FOUND，不自动创建节点。 */
  snapshot(identity: GraphIdentity): Promise<GraphSnapshot>;
  /** 按完整事务批次分页，limit 为批次数；身份不匹配拒绝，流变化或保留前缀不足返回 reset。 */
  delta(identity: GraphIdentity, cursor?: GraphCursor, limit?: number): Promise<GraphDelta>;
  /** 在同一已提交屏障读取图、独立周期摘要增量及选中详情；只读不会创建周期或推进任何序号。 */
  sessionRead(input:DispatchSessionReadInput):Promise<DispatchSessionRead>;
  /** 停止接收新操作，等待已排队提交结束后释放资源。 */
  close(): Promise<void>;
}
