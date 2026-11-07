/**
 * 作用定位：声明成员任务执行的后端持久化记录，连接已派发任务与同一大脑内核的运行身份。
 * 设计原因：领取意图必须先于模型副作用落盘；角色正文、模型参数和权限按轮次冻结，不能在恢复时隐式改用当前设置。
 * 职责边界：这里只持有无密钥的执行快照和原生会话定位，不进入公开任务图，也不把 completed 视为业务验收。
 */
import type {MemberRunBinding} from '../brain/member-run';
import type {ResolvedLlm} from '../brain/llm/ports';
import type {ChatPermission} from '../policy/types';
import type {PreparedDispatchKnowledge} from './execution-context';
import type {TaskNode} from './graph-types';
import type {MemberCheckpointProof,MemberResumeFrom} from './member-checkpoint';

/** starting 是已持久化领取意图，running 须有真实启动事实；completed 不保证存在交付候选。 */
export type DispatchRunStatus='starting'|'running'|'completed'|'failed'|'cancelled'|'interrupted';

/**
 * 单次成员运行的固定输入与事实，由内部调度事务写入。
 * 首次运行之后只允许可信检查点带来一次续执行；session.nativeSessionId 归 agentSessionId，不能按最近运行猜测。
 */
export interface DispatchRun {
  binding:MemberRunBinding;
  /** 本轮领取的 assignment 信封；与 claim 中的 runId/leaseEpoch 一起校验，不用于结果确认。 */
  assignmentMessageId:string;
  /** 仅新的续执行轮次存在，原子领取时一次消费同任务检查点；从不改写旧运行。 */
  resumeFrom?:MemberResumeFrom;
  /** 正常关闭后保存的私有检查点证明；不得经图或成员摘要暴露原生指纹。 */
  checkpointProof?:MemberCheckpointProof;
  status:DispatchRunStatus;
  /** 领取时冻结的知识基线和正文；运行及恢复时只复核，不随工作区的新版本改写。 */
  prepared:PreparedDispatchKnowledge;
  /** 领取时锁定的前置候选；旧记录和无依赖任务缺省为空，不在执行中跟随上游最新结果漂移。 */
  prerequisites?:Array<{taskId:string;planRevision:number;result:NonNullable<TaskNode['result']>}>;
  /** ResolvedLlm 中的公开参数快照；apiKey 只在启动时由装配层提供，不得落入此记录。 */
  model:ResolvedLlm['profile'];
  permission:ChatPermission;
  /** 毫秒；缺省由大脑适配器应用其默认超时，不表示永不超时。 */
  turnTimeoutMs?:number;
  /** sessionFile 是后端私有路径，仅供精确恢复，不经成员/图 IPC 返回。 */
  session:{nativeSessionId:string;sessionFile?:string};
  /** 领取事务生成的 UTC ISO 8601 时间；不等于模型已开始生成。 */
  createdAt:string;
  /** 实际引擎准备完成的 UTC ISO 8601 时间；在准备失败或接管中断时可以缺省。 */
  startedAt?:string;
  /** 终态提交的 UTC ISO 8601 时间；starting/running 时不得存在。 */
  settledAt?:string;
  /** 可公开的简短失败说明，不存原始提示词、工具正文或凭据。 */
  error?:string;
}
