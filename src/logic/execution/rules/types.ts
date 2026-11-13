/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。

 * 范围工具端口仅由正式成员Runtime注入；各引擎据此移除全部原生文件与命令，不能由模型消息声明获得。
 * 受控文件边界：写入及冻结删除/移动均只向引擎提供严格 list/call，不暴露平台原端口、阶段保存或授权签发能力。
 * 作用定位：大脑 执行层：与具体引擎无关的任务、事件、工具策略和执行摘要契约。
 * 设计原因：任务身份与原生上下文分开；选定文件、完整集合观察、产物验证与逐段检查点由独立可信端口记录，不由引擎自报。续执行准备复核原冻结证明，历史读取不猜测恢复。
 * 各引擎共享生命周期与工具门禁；engineHandoff 只携带公开上下文，不改变原调用身份或授权。
 */
import type {TaskSpec} from '../../tasks/rules/types';
import type {ToolCall,ToolDecision} from '../../tools/rules/types';
import type {MemberRunBinding} from './member-run';
import type {RunInputSource} from './input-source';
import type {ConversationAgentBinding} from './conversation-binding';
export type {RunInputSource} from './input-source';
export type {TaskSpec} from '../../tasks/rules/types';
export type {ChatPermission,ChatApproval} from '../../tools/rules/policy/types';
export type {ToolCall,ToolDecision} from '../../tools/rules/types';
/** 引擎无关的运行状态；completed 只表示本轮结束，interrupted 表示终态或工具结果仍需核实。 */
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export interface EngineEvent {
  /** 代码检查事件仅由授权后的可信执行端口写入。 */
  type: 'code.validation_checked' | 'run.started' | 'session.bound' | 'message' | 'message.delta' | 'tool.started' | 'tool.finished' |
     'tool.proposed' | 'tool.allowed' | 'tool.denied' | 'tool.updated' | 'task.updated' | 'task.help_requested' | 'task.checkpoint_requested' | 'artifact.baseline_captured' | 'artifact.manifest_captured' | 'artifact.transition_prepared' | 'artifact.transition_executing' | 'artifact.transition_applied' | 'validation.checked' | 'engine.status' | 'run.stop_requested' | 'run.settled' | 'run.interrupted';
  data: Record<string, unknown>;
}
/** 事件落盘后的身份与顺序信息；观察者只能收到成功持久化的记录。 */
export interface StoredEvent extends EngineEvent {
  version: 1;
  /** 当前 run 内从 1 递增的顺序号。 */
  seq: number;
  taskId: string;
  runId: string;
  workspaceId: string;
  /** 日志生成的 UTC ISO 8601 时间；连续性以 seq 判断，不按时钟重排事件。 */
  time: string;
}
/** 原始图片快照；由主进程读取，作为用户输入而非系统指令。 */
export interface InputImage {type:'image';data:string;mimeType:string}
/** 运行时注入适配器的能力；适配器不得绕过 beforeTool 直接放行工具。 */
export interface EngineContext {
  task: TaskSpec;
  runId: string;
  /** 任务记录根下的 taskId/runId 子目录，供本轮配置和桥接文件落盘；不是业务工程根目录。 */
  directory: string;
  /** 待续接的后端私有会话文件；适配器必须核实归属，缺省表示新建。 */
  sessionFile?: string;
  /** 恢复时为目标引擎实际绑定的原生身份；Pi/Claude 新建可指定，Codex 新建由 App Server 分配并经 session.bound 回报。 */
  nativeSessionId?:string;
  /** 主对话跨引擎切换时转交的公开日志资料；不是用户的新指令，不用于恢复成员。 */
  engineHandoff?:string;
  /** 可信成员执行身份；适配器不能自行改变任务、成员或租约绑定。 */
  memberBinding?:MemberRunBinding;
  /** 可信主对话登记身份；聊天通道与正式任务通道不混用，原生历史仍由 sessionFile 校验。 */
  conversationBinding?:ConversationAgentBinding;
  /** 仅可信接续入口存在；成员结果是资料，显式用户补充保持用户消息，不混淆授权。 */
  source?:RunInputSource;
  /** 可信装配提供的工具能力；引擎只消费目录、调用与通用策略，不认识具体业务类。 */
  capabilities?:readonly import('./engine-tools').EngineCapability[];
  /** 可信续执行的完整冻结证明复核，Pi 在载入前及载入后配置前调用；同时核实文件、知识、日志和原生指纹。 */
  assertMemberResume?():Promise<void>;
  /** 返回前完成持久化；失败必须停止依赖这份证据的操作。 */
  emit(event: EngineEvent): Promise<void>;
  /** 决策及证据先落盘，返回 allow 才可执行。 */
  beforeTool(call: ToolCall): Promise<ToolDecision>;
}
/** 引擎生命周期；close 必须释放进程/桥并排空事件，run 终态不表示业务验收通过。 */
export interface AgentEngine {
  readonly kind: string;
  /** 准备进程、工具桥及原生会话；此阶段不发送本轮模型提示，失败后仍由调用方 close。 */
  start(context: EngineContext): Promise<void>;
  /** 发起本轮生成并等待引擎终态；异常交给运行时记录为中断，不能据异常自动重放工具。 */
  run(message: string): Promise<{status: 'completed' | 'cancelled' | 'failed'; error?: string}>;
  /**
   * 在当前工具批次完成后注入用户补充；不切换模型或授权。
   * signal 只阻止尚未发送的插入；适配器在准备 await 后复验。原生已确认 queued 后不得因迟到取消改报未接收，发送后的无确认错误保持未知且不重发。
   */
  steer?(message:string,images:InputImage[],signal:AbortSignal):Promise<void>;
  /** 请求停止；返回只表示停止请求已处理，不保证工具副作用已消除或日志已经结算。 */
  stop(): Promise<void>;
  close(): Promise<void>;
}
/** 从执行事实恢复的摘要；未收到结果的已放行工具必须人工核实，不能自动重放。 */
export interface RunSummary {
  task: TaskSpec;
  runId: string;
  status: RunStatus;
  acceptance: 'not_evaluated';
  sessionFile?: string;
  /** 仅成员执行存在；来自 run.started 的固定绑定，不根据角色名猜测。 */
  memberBinding?:MemberRunBinding;
  /** 从 run.started 恢复的主对话实例身份；旧历史缺省，不根据角色名补造。 */
  conversationBinding?:ConversationAgentBinding;
  /** 从 run.started 恢复；用于识别已经尝试回注的批次，不代表该批次业务已验收。 */
  source?:RunInputSource;
  unresolvedTools: string[];
  /** 新运行的工具事实回执；旧日志可能没有，不能补造为已验收证据。 */
  toolReceipts?:import('../../tools/rules/types').ToolReceipt[];
  /** 最近一次持久化计划；未创建计划的普通问答为空。 */
  taskProgress?:import('../../evidence/rules/progress').TaskProgress;
  events: StoredEvent[];
  /** 仅持久日志读取提供；缺省表示该摘要未报告磁盘完整性，不能猜测为完好。未完成尾行不解析或改写。 */
  logIntegrity?:{partialTail:boolean};
}
/** 只读展示全部可核实历史；issues 不代表任务未执行，resumeRunId 缺省时不得猜测较早的可读轮次续聊。 */
export interface ConversationThreadView {
  runs:RunSummary[];
  issues:{runId:string;code:string;message:string}[];
  /** 当前上下文全部日志可核实时的最后一轮；新上下文意图尚未形成日志时也为空。 */
  resumeRunId?:string;
}
