/**
 * 目录归属：backend/scheduler-engine/members；主运行与成员执行管理。
 * 持久等待可保留多段任务的最新检查点；继续重核全链日志和累计文件，历史段不自动重放。
 * 作用定位：核实持久等待的成员原记录，并在用户明确继续时重新检查岗位、知识、native 与文件。
 * 设计原因：重启只读登记等待，不触碰原生会话；继续先取业务读占用，再按知识→模型→Store 的顺序核实，失败不消费等待。预检结果不缓存为执行许可，预约及领取仍各自重核。
 */
import {fail} from '../../../core/errors';
import type {DispatchKnowledgeWorkspace} from '../context/execution-context';
import type {DispatchState,DispatchStore} from '../../../logic/dispatch/rules/dispatch-storage';
import type {DispatchScope} from '../../../logic/tasks/rules/dispatch-scope';
import type {GoalContinuationRequest} from '../../../logic/tasks/rules/scope-continuation';
import type {MemberPause} from '../../../logic/tasks/rules/member-pause';
import {memberPauseSelection,assertMemberPausePermission} from '../../../logic/tasks/rules/member-pause-rules';
import {verifyMemberCheckpointHistory,verifyMemberCheckpointProof,type MemberCheckpointVerificationPorts} from './member-checkpoint-verifier';
import type {OwnerExecutionService,OwnerExecutionContext} from '../dispatch/owner-execution-service';

/** 同一平台的只读能力；acquireRead 不等待执行，不修改文件，释放函数必须在失败路径调用。 */
export interface MemberPausePorts extends MemberCheckpointVerificationPorts {acquireRead():()=>void;assertCurrent():void}
export class MemberPauseService {
  constructor(private readonly owner:DispatchKnowledgeWorkspace,private readonly store:DispatchStore,private readonly owners:OwnerExecutionService,private readonly ports?:MemberPausePorts){}
  private available(){if(!this.ports)fail('GOAL_MEMBER_PAUSE_UNAVAILABLE','当前工作区未装配成员持久等待核实能力');return this.ports}
  private scope(state:DispatchState,request:GoalContinuationRequest){
    const scope=state.scopes?.find(s=>s.workspaceId===request.workspaceId&&s.rootSessionId===request.rootSessionId&&s.scopeId===request.scopeId);
    if(state.workspaceId!==this.owner.entry.id||request.workspaceId!==this.owner.entry.id||scope?.status!=='waiting'||!scope.wait?.memberPause||scope.wait.waitId!==request.waitId||scope.goal?.revision!==request.expectedGoalRevision||(scope.goal.inputRevision??1)!==request.expectedInputRevision)fail('GOAL_WAIT_CONFLICT','成员等待或目标版本已变化，请刷新后核实');
    return scope;
  }
  /** 审阅/停泊事务内只核历史日志；不反向取得锁、不重新生成原 proof。 */
  async verifyWaiting(state:DispatchState,scope:DispatchScope,pause:MemberPause):Promise<void>{
    const ports=this.available(),selected=memberPauseSelection(state,scope,pause);
    for(const {task,run}of selected.checkpoints)await verifyMemberCheckpointHistory(this.owner,task,run,ports,()=>ports.assertCurrent(),state.runs);
  }
  /** 预检取得短读占用；可信 beforeRun 已持主运行占用，不能再次领取与自身写租约冲突的读锁。该标记不是工具输入。 */
  async withContext<T>(request:GoalContinuationRequest,alive:()=>void,use:(context:OwnerExecutionContext)=>Promise<T>,mainLeaseHeld=false):Promise<T>{
    const ports=this.available(),assert=()=>{this.owner.assert();ports.assertCurrent();alive()};assert();const release=mainLeaseHeld?()=>{}:ports.acquireRead();
    try{return await this.owners.withContext(state=>{const scope=this.scope(state,request);return this.owners.selections(memberPauseSelection(state,scope,scope.wait!.memberPause!).tasks)},use,assert)}finally{release()}
  }
  /** 在已持有外层快照的最终状态中核验；不升级成员权限、不刷新旧 native 或文件指纹。 */
  async validateCurrent(state:DispatchState,request:GoalContinuationRequest,context:OwnerExecutionContext,alive:()=>void):Promise<void>{
    const ports=this.available(),scope=this.scope(state,request),selected=memberPauseSelection(state,scope,scope.wait!.memberPause!),assert=()=>{this.owner.assert();ports.assertCurrent();alive()};assert();
    assertMemberPausePermission(selected.checkpoints,request.options.permission);
    if(context.snapshot.revision!==scope.wait!.knowledgeRevision||scope.goal?.plan?.knowledgeRevision!==context.snapshot.revision)fail('GOAL_KNOWLEDGE_CHANGED','等待期间知识发生变化，原成员不能沿旧计划继续');
    for(const task of selected.tasks){await this.owners.verifyTask(state,context,task);assert()}
    for(const {task,run}of selected.checkpoints){await verifyMemberCheckpointProof(this.owner,task,run,ports,assert,run.checkpointProof,state.runs);assert()}
    await this.owners.recheck(context.snapshot,assert);
  }
  /** 用户明确继续才调用；失败保留原等待，成功也不消费或启动。最终受理事务再次核实同一清单。 */
  async preflight(request:GoalContinuationRequest,alive:()=>void=()=>{}):Promise<void>{
    await this.withContext(request,alive,async context=>{
      await this.validateCurrent(await this.store.read(),request,context,alive);
      const latest=await this.store.read(),scope=this.scope(latest,request);memberPauseSelection(latest,scope,scope.wait!.memberPause!);alive();
    });
  }
}
