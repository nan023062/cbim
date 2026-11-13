/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 保留成员的等待在外层知识/模型快照及最终 Store 内重核；同命令竞争返回原意图，较低权限不能隐式恢复较高权限成员。
 * 作用定位：原子消费安全等待，保存用户原始补充、可选附件快照清单和一次性主运行意图。
 * 设计原因：先查原命令，再由可信启动闭包提交清单；运行中插入与等待补充共用输入次数和正文额度。预算读取后及提交前复核停止，拒绝不会消费等待或运行额度。
 * 职责边界：旧纯文本兼容，不读取附件或启动模型，不签署人工项；事务已提交后的失败保留原意图，不还原等待或重放。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';
import {safeId} from '../../../logic/execution/ports/identity';
import {hash,json} from '../../../core/platform/node/serialization';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {DispatchStore,DispatchState} from '../../../logic/dispatch/rules/dispatch-storage';
import type {DispatchScope} from '../../../logic/tasks/rules/dispatch-scope';
import {appendScopeMainRun} from '../../../logic/tasks/rules/scope-run-tracking';
import {goalInputRevision,scopeGoalDecisionLimit,sameGoalValue} from '../../../logic/tasks/rules/scope-goal';
import {assertContinuationAttachmentManifest,type TrustedContinuationInput} from '../../../logic/tasks/rules/scope-continuation-attachments';
import {goalContinuationRequestSchema,scopeContinuationLookupSchema,scopeContinuationTotalTextLimit,type GoalContinuationRequest,type GoalContinuationReceipt,type ScopeContinuation,type ScopeContinuationLookup} from '../../../logic/tasks/rules/scope-continuation';
import {rejectBudget,type ScopeBudgetService,type ScopeBudgetRejected} from '../budget/scope-budget-service';
import {isHumanContinuation} from '../../../logic/tasks/rules/scope-continuation-record';
import {scopeActiveInputLimits} from '../../../logic/tasks/rules/scope-active-input';
import type {MemberPauseService} from '../members/member-pause-service';
import type {OwnerExecutionContext} from '../dispatch/owner-execution-service';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
/** fresh 仅本次进程事务返回，绝不写入 durable receipt；即使为 true，调用方仍需复核停止与当前 scope 状态。 */
export interface AcceptedScopeContinuation {scope:DispatchScope;continuation:ScopeContinuation;fresh:boolean}

export class ScopeContinuationService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore,private readonly budgets?:ScopeBudgetService,private readonly memberPauses?:MemberPauseService){}
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
  async accept(raw:GoalContinuationRequest,trustedRunId:string,trusted:TrustedContinuationInput={}):Promise<AcceptedScopeContinuation>{
    const input=this.parse(goalContinuationRequestSchema,raw),runId=safeId(trustedRunId);
    this.owner.assert();check(input.workspaceId===this.owner.entry.id,'GOAL_IDENTITY','目标不属于当前工作区');
    // 在第一个 await 前隔离可信快照；已受理重查不需要快照仍存在，也不验证后来提供的快照。
    const signal=trusted.signal;let attachmentManifest:unknown,manifestCopyFailed=false;
    try{attachmentManifest=structuredClone(trusted.attachmentManifest)}catch{manifestCopyFailed=true}
    const replay=(scope:DispatchScope):AcceptedScopeContinuation|undefined=>{const existing=scope.continuations?.find(item=>item.continuationId===input.commandId);if(!existing)return;
      check(!isHumanContinuation(existing)&&existing.wait.waitId===input.waitId&&existing.wait.goalRevision===input.expectedGoalRevision&&existing.inputRevision===input.expectedInputRevision+1&&sameGoalValue(existing.input,input.input)&&sameGoalValue(existing.options,input.options),'COMMAND_ID_CONFLICT','原命令已受理，不能更换补充正文、附件、等待版本或运行选项');
      return {scope,continuation:existing,fresh:false};
    };
    const observed=this.scope(await this.store.read(),input),prior=replay(observed);if(prior)return prior;
    const alive=()=>{this.owner.assert();signal?.throwIfAborted()};alive();
    if(manifestCopyFailed)fail('GOAL_ATTACHMENT_MANIFEST','附件快照清单无法复制，尚未受理补充');
    assertContinuationAttachmentManifest(input.input,attachmentManifest);
    let fresh=false;
    const save=(context?:OwnerExecutionContext)=>this.store.transact<GoalContinuationReceipt|ScopeBudgetRejected>({commandId:'scope-continue-'+input.commandId,fingerprint:hash(json({operation:'scope.continue',input,...(attachmentManifest===undefined?{}:{attachmentManifest})}))},async state=>{
      alive();
      const scope=this.scope(state,input),goal=scope.goal,wait=scope.wait;
      check(scope.status==='waiting'&&wait,'GOAL_NOT_WAITING','目标不处于安全等待，不能继续或重复消费等待');
      check(goal&&!goal.blocked&&goal.plan&&goal.review?.decision==='awaiting_user','GOAL_CONTINUATION_UNAVAILABLE','目标没有可继续的安全等待记录');
      check(!scope.recovery||input.options.permission==='read','RECOVERY_READONLY','只读核实周期不能通过补充输入提升执行权限');
      check(wait.waitId===input.waitId,'GOAL_WAIT_CONFLICT','等待检查点已变化，请刷新目标');
      check(goal.revision===input.expectedGoalRevision&&goalInputRevision(goal)===input.expectedInputRevision,'GOAL_REVISION_CONFLICT','目标或补充版本已变化，请刷新后重试');
      check(wait.mainRunIds.length<32,'GOAL_CYCLE_LIMIT','本次目标已达到 32 次主调度运行，不能通过补充重置预算');
      check(goalInputRevision(goal)<scopeActiveInputLimits.inputs,'GOAL_INPUT_LIMIT','当前目标输入版本已达到上限，不能通过等待继续重置次数');
      check(goal.revision+3<=scopeGoalDecisionLimit+1,'GOAL_DECISION_LIMIT','剩余目标版本不足以接收补充并重新规划审阅');
      check(!wait.mainRunIds.includes(runId)&&!state.runs?.some(run=>run.binding.runId===runId)&&!state.scopes?.some(value=>value.continuations?.some(item=>item.runId===runId)),'GOAL_RUN_CONFLICT','主运行身份已经被使用，不能重复启动');
      check((scope.continuations??[]).reduce((total,item)=>total+(isHumanContinuation(item)?0:item.input.message.length),0)+(scope.activeInputs??[]).reduce((total,item)=>total+(item.status==='rejected'?0:item.messageCharacters),0)+input.input.message.length<=scopeContinuationTotalTextLimit,'GOAL_INPUT_LIMIT','本目标补充正文累计超过允许大小，请结束后另建目标');
      check(!state.runs?.some(run=>run.binding.rootSessionId===scope.rootSessionId&&['starting','running'].includes(run.status)),'GOAL_WORK_PENDING','本主会话仍有在途成员运行');
      if(wait.memberPause){check(context&&this.memberPauses,'GOAL_MEMBER_PAUSE_UNAVAILABLE','原成员等待必须重新核实后继续');await this.memberPauses.validateCurrent(state,input,context,alive);alive()}
      const admitted=await this.budgets?.admit(state,scope,{kind:'main',taskId:scope.rootSessionId,runId});
      // 额度读取可能等待磁盘；停止后的拒绝结果也不能顺带修改原安全等待。
      alive();
      if(admitted?.rejected)return {scopes:[admitted.scope],receipt:admitted.rejected};
      const continuation:ScopeContinuation={continuationId:input.commandId,acceptedAt:new Date().toISOString(),wait:structuredClone(wait),inputRevision:goalInputRevision(goal)+1,input:input.input,runId,options:input.options,...(attachmentManifest===undefined?{}:{attachmentManifest})};
      const {wait:_consumed,...rest}=admitted?.scope??scope,{review:_stale,...originalGoal}=goal;
      const next=appendScopeMainRun<DispatchScope>({...rest,status:'active',goal:{...originalGoal,revision:goal.revision+1,inputRevision:continuation.inputRevision},continuations:[...(scope.continuations??[]),continuation]},runId);
      const saved:GoalContinuationReceipt={workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,scopeStatus:next.status,continuation};
      alive();fresh=true;return {scopes:[next],receipt:saved};
    });
    // 先查幂等历史，再取得知识→模型→Store；绝不能从上述事务内部反向取得岗位快照。
    if(observed.wait?.memberPause&&!this.memberPauses)fail('GOAL_MEMBER_PAUSE_UNAVAILABLE','当前工作区未装配成员等待核实能力');
    let receipt:GoalContinuationReceipt|ScopeBudgetRejected;
    // accept 仅在运行时取得主租约后的 beforeRun 调用；预检仍独立取得短读锁，两处均重核原等待基线。
    try{receipt=observed.wait?.memberPause?await this.memberPauses!.withContext(input,alive,context=>save(context),true):await save()}
    catch(error){
      // 同命令并发可能在取得外层锁前已消费等待；只返回其不可变原事实，不重做核实、换 run 或伪造 fresh。
      const saved=replay(this.scope(await this.store.read(),input));if(saved)return saved;throw error;
    }
    if('budgetRejected' in receipt)rejectBudget(receipt);
    const scope=this.scope(await this.store.read(),input),continuation=scope.continuations?.find(item=>item.continuationId===input.commandId);
    check(continuation&&!isHumanContinuation(continuation)&&continuation.runId===receipt.continuation.runId,'GOAL_CONTINUATION_UNAVAILABLE','已提交补充记录与当前周期不一致，不能启动');
    return {scope,continuation,fresh};
  }
}
