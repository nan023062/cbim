/**
 * 作用定位：在既有派发日志中可靠消费安全等待，并保存用户显式补充与一次性主运行启动意图。
 * 设计原因：运行时在租约和历史预检后注入真实 runId，按冻结软限额核实后才与消费等待同事务追加清单；预算拒绝仅登记独立阻塞，不消费等待、输入版本或启动意图。旧周期不补造归属，核实补充仍须 read。
 * 职责边界：只接受文本分支，不返回或伪造人工接续；不启动模型、不批准 human 项。调用方须核验停止信号，提交后失败不得还原等待或重用意图。
 */
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {safeId} from '../../core/foundation/identity';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore,DispatchState} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import {appendScopeMainRun} from '../../core/tasks/scope-run-tracking';
import {goalInputRevision,scopeGoalDecisionLimit} from '../../core/tasks/scope-goal';
import {goalContinuationRequestSchema,scopeContinuationLookupSchema,scopeContinuationTotalTextLimit,type GoalContinuationRequest,type GoalContinuationReceipt,type ScopeContinuation,type ScopeContinuationLookup} from '../../core/tasks/scope-continuation';
import {rejectBudget,type ScopeBudgetService,type ScopeBudgetRejected} from './scope-budget-service';
import {isHumanContinuation} from '../../core/tasks/scope-continuation-record';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
/** fresh 仅本次进程事务返回，绝不写入 durable receipt；即使为 true，调用方仍需复核停止与当前 scope 状态。 */
export interface AcceptedScopeContinuation {scope:DispatchScope;continuation:ScopeContinuation;fresh:boolean}

export class ScopeContinuationService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore,private readonly budgets?:ScopeBudgetService){}
  private parse<S extends z.ZodTypeAny>(schema:S,input:unknown):z.output<S>{const parsed=schema.safeParse(input);if(!parsed.success)fail('GOAL_CONTINUATION_INPUT',parsed.error.issues.map(issue=>issue.message).join('；'));return parsed.data}
  private scope(state:DispatchState,input:ScopeContinuationLookup):DispatchScope{
    this.owner.assert();check(this.owner.entry.id===input.workspaceId&&state.workspaceId===input.workspaceId,'GOAL_IDENTITY','目标不属于当前工作区');
    const scope=state.scopes?.find(scope=>scope.scopeId===input.scopeId&&scope.rootSessionId===input.rootSessionId&&scope.workspaceId===input.workspaceId);
    check(scope,'GOAL_IDENTITY','目标周期不属于当前主会话');return scope;
  }
  /** 只查现有日志事实，不核实模型或原生会话，不产生启动授权；active/closed 也保留原接收记录。 */
  async inspect(raw:ScopeContinuationLookup):Promise<GoalContinuationReceipt|undefined>{
    const input=this.parse(scopeContinuationLookupSchema,raw),scope=this.scope(await this.store.read(),input),continuation=scope.continuations?.find(item=>item.continuationId===input.commandId);
    return continuation&&!isHumanContinuation(continuation)?{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:scope.status,continuation}:undefined;
  }
  /**
   * 仅可信 beforeRun 调用，runId 已由运行时分配。指纹不含随机 runId，相同命令永远返回第一次接收记录；变更请求则冲突。
   * waiting→active、补充输入版本及旧检查点归档在同一事务提交；未提交不消费，提交后错误由调用方关闭并保留历史，不自动重试。
   */
  async accept(raw:GoalContinuationRequest,trustedRunId:string):Promise<AcceptedScopeContinuation>{
    const input=this.parse(goalContinuationRequestSchema,raw),runId=safeId(trustedRunId);
    this.owner.assert();check(input.workspaceId===this.owner.entry.id,'GOAL_IDENTITY','目标不属于当前工作区');
    let fresh=false;
    const receipt=await this.store.transact<GoalContinuationReceipt|ScopeBudgetRejected>({commandId:'scope-continue-'+input.commandId,fingerprint:hash(json({operation:'scope.continue',input}))},async state=>{
      const scope=this.scope(state,input),goal=scope.goal,wait=scope.wait;
      check(scope.status==='waiting'&&wait,'GOAL_NOT_WAITING','目标不处于安全等待，不能继续或重复消费等待');
      check(goal&&!goal.blocked&&goal.plan&&goal.review?.decision==='awaiting_user','GOAL_CONTINUATION_UNAVAILABLE','目标没有可继续的安全等待记录');
      check(!scope.recovery||input.options.permission==='read','RECOVERY_READONLY','只读核实周期不能通过补充输入提升执行权限');
      check(wait.waitId===input.waitId,'GOAL_WAIT_CONFLICT','等待检查点已变化，请刷新目标');
      check(goal.revision===input.expectedGoalRevision&&goalInputRevision(goal)===input.expectedInputRevision,'GOAL_REVISION_CONFLICT','目标或补充版本已变化，请刷新后重试');
      check(wait.mainRunIds.length<32,'GOAL_CYCLE_LIMIT','本次目标已达到 32 次主调度运行，不能通过补充重置预算');
      check(goal.revision+3<=scopeGoalDecisionLimit+1,'GOAL_DECISION_LIMIT','剩余目标版本不足以接收补充并重新规划审阅');
      check(!wait.mainRunIds.includes(runId)&&!state.runs?.some(run=>run.binding.runId===runId)&&!state.scopes?.some(value=>value.continuations?.some(item=>item.runId===runId)),'GOAL_RUN_CONFLICT','主运行身份已经被使用，不能重复启动');
      check((scope.continuations??[]).reduce((total,item)=>total+(isHumanContinuation(item)?0:item.input.message.length),0)+input.input.message.length<=scopeContinuationTotalTextLimit,'GOAL_INPUT_LIMIT','本目标补充正文累计超过允许大小，请结束后另建目标');
      check(!state.runs?.some(run=>run.binding.rootSessionId===scope.rootSessionId&&['starting','running'].includes(run.status)),'GOAL_WORK_PENDING','本主会话仍有在途成员运行');
      const admitted=await this.budgets?.admit(state,scope,{kind:'main',taskId:scope.rootSessionId,runId});
      if(admitted?.rejected)return {scopes:[admitted.scope],receipt:admitted.rejected};
      const continuation:ScopeContinuation={continuationId:input.commandId,acceptedAt:new Date().toISOString(),wait:structuredClone(wait),inputRevision:goalInputRevision(goal)+1,input:input.input,runId,options:input.options};
      const {wait:_consumed,...rest}=admitted?.scope??scope,{review:_stale,...originalGoal}=goal;
      const next=appendScopeMainRun<DispatchScope>({...rest,status:'active',goal:{...originalGoal,revision:goal.revision+1,inputRevision:continuation.inputRevision},continuations:[...(scope.continuations??[]),continuation]},runId);
      const saved:GoalContinuationReceipt={workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:next.status,continuation};
      fresh=true;return {scopes:[next],receipt:saved};
    });
    if('budgetRejected' in receipt)rejectBudget(receipt);
    const scope=this.scope(await this.store.read(),input),continuation=scope.continuations?.find(item=>item.continuationId===input.commandId);
    check(continuation&&!isHumanContinuation(continuation)&&continuation.runId===receipt.continuation.runId,'GOAL_CONTINUATION_UNAVAILABLE','已提交补充记录与当前周期不一致，不能启动');
    return {scope,continuation,fresh};
  }
}
