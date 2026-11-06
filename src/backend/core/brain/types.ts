/**
 * 作用定位：大脑 执行层：与具体引擎无关的任务、事件、工具策略和执行摘要契约。
 * 设计原因：引擎可选 steer 在当前工具批次之后注入用户补充，不改变模型或权限；任务身份与引擎会话分开，区分主 Agent 对话与团队工作流快照，保存公开文本增量；执行结束不代表业务验收通过。
 */
import type {TaskSpec} from '../tasks/types';
import type {ToolCall,ToolDecision} from '../tools/types';
export type {TaskSpec} from '../tasks/types';
export type {ChatPermission,ChatApproval} from '../policy/types';
export type {ToolCall,ToolDecision} from '../tools/types';
/** Engine-neutral contract. No Electron, MCP or application database dependency. */
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export interface EngineEvent {
  type: 'run.started' | 'session.bound' | 'message' | 'message.delta' | 'tool.started' | 'tool.finished' |
    'tool.proposed' | 'tool.allowed' | 'tool.denied' | 'tool.updated' | 'engine.status' | 'run.stop_requested' | 'run.settled' | 'run.interrupted';
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
  time: string;
}
/** 原始图片快照；由主进程读取，作为用户输入而非系统指令。 */
export interface InputImage {type:'image';data:string;mimeType:string}
/** 运行时注入适配器的能力；适配器不得绕过 beforeTool 直接放行工具。 */
export interface EngineContext {
  task: TaskSpec;
  runId: string;
  directory: string;
  sessionFile?: string;
  /** 返回前完成持久化；失败必须停止依赖这份证据的操作。 */
  emit(event: EngineEvent): Promise<void>;
  /** 决策及证据先落盘，返回 allow 才可执行。 */
  beforeTool(call: ToolCall): Promise<ToolDecision>;
}
/** 引擎生命周期；close 必须释放进程/桥并排空事件，run 终态不表示业务验收通过。 */
export interface AgentEngine {
  readonly kind: string;
  start(context: EngineContext): Promise<void>;
  run(message: string): Promise<{status: 'completed' | 'cancelled' | 'failed'; error?: string}>;
  /** 在当前工具批次完成后注入用户补充；不切换模型或授权，不中止当前工具。 */
  steer?(message:string,images?:InputImage[]):Promise<void>;
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
  unresolvedTools: string[];
  events: StoredEvent[];
}
