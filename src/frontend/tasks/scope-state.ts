/**
 * 作用定位：主会话目标周期的增量投影和展示状态，供对话摘要与任务根详情共用。
 * 设计原因：目标版本独立于任务图；先核对身份和连续游标再合并，完成申请与真正关闭分开显示，历史选择不能覆盖当前任务状态。
 * 职责边界：只投影后端事实；运行内补充优先展示接收中/待核实，已接收也不是完成。摘要与详情须核对同一补充状态，不能用旧审阅盖过未知输入。
 * 详情契约：只持有 PublicDispatchScope 的安全来源和新处置引用，不能将公共投影当作含原生上下文的完整持久周期。
 */
import {applyScopeBatch,validateScopeSnapshot,scopeActiveInputStatus,scopeActiveInputSchema} from '../../bridge/contracts/dispatch';
import type {PublicDispatchScope,DispatchSessionRead,GraphIdentity,GraphSnapshot,ScopeCursor,ScopeDelta,ScopeSnapshot,ScopeSummary,ScopeDetailStamp} from '../../bridge/contracts/dispatch';
import {SessionGraphProjection} from './graph-state';

const sameCursor=(a:ScopeCursor,b:ScopeCursor)=>a.kind===b.kind&&a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId&&a.streamId===b.streamId&&a.seq===b.seq;
/** 在完整响应验证成功前保留旧快照；无变化时保持原对象引用。 */
export class SessionScopeProjection {
  private value?:ScopeSnapshot;
  constructor(readonly identity:GraphIdentity){}
  get snapshot(){return this.value}
  get cursor(){return this.value?.cursor}
  fork(){const next=new SessionScopeProjection(this.identity);next.value=this.value;return next}
  apply(response:ScopeDelta):ScopeSnapshot{
    const cursor=response.cursor;
    if(cursor.kind!=='scopes'||cursor.workspaceId!==this.identity.workspaceId||cursor.rootSessionId!==this.identity.rootSessionId)throw Error('目标响应属于其他会话');
    let next=this.value;
    if(response.mode==='reset'){
      const snapshot=response.snapshot;
      validateScopeSnapshot(snapshot);
      if(snapshot.identity.workspaceId!==this.identity.workspaceId||snapshot.identity.rootSessionId!==this.identity.rootSessionId||!sameCursor(snapshot.cursor,cursor))throw Error('目标快照身份或游标不一致');
      if(new Set(snapshot.scopes.map(scope=>scope.scopeId)).size!==snapshot.scopes.length||snapshot.scopes.some(scope=>scope.stamp.scopeId!==scope.scopeId||scope.stamp.streamId!==cursor.streamId||scope.stamp.seq>cursor.seq))throw Error('目标快照包含重复身份或无效详情版本');
      if(next&&next.cursor.streamId===cursor.streamId&&cursor.seq<next.cursor.seq)throw Error('目标快照版本回退');
      if(next&&sameCursor(next.cursor,cursor)){if(JSON.stringify(next)!==JSON.stringify(snapshot))throw Error('相同目标版本的内容不一致')}
      else next=snapshot;
    }else if(response.mode==='noop'){
      if(!next||!sameCursor(next.cursor,cursor))throw Error('目标无变化响应与本地游标不一致');
    }else{
      if(!next||!sameCursor(next.cursor,response.from)||!response.batches.length)throw Error('目标增量断档');
      for(const batch of response.batches)next=applyScopeBatch(next,batch);
      if(!sameCursor(next.cursor,cursor))throw Error('目标增量未到达响应游标');
    }
    this.value=next;return next;
  }
}

/** UI 状态不等同于模型生成状态；completed 只来自可靠关闭，不来自 review.decision。 */
export interface GoalView {label:string;tone:'running'|'warning'|'success'|'neutral';phase:string}
export function scopeGoalView(scope:ScopeSummary|undefined,graph?:GraphSnapshot):GoalView{
  if(!scope)return {phase:'none',label:'尚无本轮目标记录',tone:'neutral'};
  if(!scope.hasGoal)return {phase:'legacy',label:'旧周期 · 未保存原始目标',tone:'neutral'};
  if(scope.status==='closed'){
    if(scope.outcome==='completed'&&scope.activeInputStatus)return {phase:'completion_unverified',label:'周期已结束 · 补充接收未确认',tone:'warning'};
    if(scope.outcome==='completed')return scope.hasPlan?(scope.reviewDecision==='complete'&&!scope.needsReplan?{phase:'completed',label:'目标已完成',tone:'success'}:{phase:'completion_unverified',label:'周期已结束 · 完成依据不完整',tone:'warning'}):{phase:'conversation_finished',label:'本轮对话结束',tone:'neutral'};
    if(scope.outcome==='cancelled')return {phase:'cancelled',label:'本轮已停止',tone:'neutral'};
    if(scope.outcome==='interrupted')return {phase:'interrupted',label:'目标执行中断',tone:'warning'};
    return {phase:scope.blockedReason?'blocked':'failed',label:scope.hasPlan?'目标未完成':'业务目标未建立',tone:'warning'};
  }
  if(scope.activeInputStatus==='unknown')return {phase:'input_unknown',label:'补充接收结果待核实',tone:'warning'};
  if(scope.activeInputStatus==='pending')return {phase:'input_pending',label:'正在确认补充接收',tone:'running'};
  if(scope.status==='waiting')return {phase:'waiting',label:'等待补充 · 执行已暂停',tone:'warning'};
  if(scope.needsReplan)return {phase:'replanning',label:'补充已受理 · 等待更新计划',tone:'running'};
  if(scope.blockedReason||scope.reviewDecision==='blocked')return {phase:'blocked',label:'目标受阻',tone:'warning'};
  if(scope.reviewDecision==='complete')return {phase:'review_pending',label:'完成申请待复核',tone:'warning'};
  if(scope.reviewDecision==='awaiting_user')return {phase:'awaiting_user',label:'已请求补充 · 等待暂停确认',tone:'warning'};
  const tasks=graph?.tasks.filter(task=>task.scopeId===scope.scopeId)??[];
  if(tasks.some(task=>task.status==='running'||task.activeRunId))return {phase:'executing',label:'成员正在执行',tone:'running'};
  if(tasks.some(task=>['planned','queued'].includes(task.status)))return {phase:'queued',label:'等待成员执行',tone:'running'};
  if(tasks.some(task=>task.status==='checkpointed'))return {phase:'member_checkpoint',label:'成员已保存检查点 · 等待调度',tone:'warning'};
  if(tasks.some(task=>task.status==='waiting'))return {phase:'waiting_members',label:'等待任务前置',tone:'running'};
  if(tasks.length)return {phase:'reviewing',label:'等待主 Agent 审阅',tone:'running'};
  if(!scope.hasPlan&&scope.origin==='business_replan')return {phase:'business_planning',label:'正在规划业务任务',tone:'running'};
  if(!scope.hasPlan&&scope.origin==='inspection')return {phase:'inspection_planning',label:'正在规划只读核实',tone:'running'};
  return scope.hasPlan?{phase:'planning',label:'正在推进目标',tone:'running'}:{phase:'chat',label:'普通对话处理中',tone:'running'};
}
/** 自动跟随开放周期（执行或持久等待），否则按后端首次创建事务顺序取最新历史，不按本机时间或随机标识重排。 */
export function currentScope(scopes:readonly ScopeSummary[]):ScopeSummary|undefined{
  // 存储按首次创建事务保持插入顺序，更新旧周期不会移位；与后端自动详情选择保持一致。
  return scopes.find(scope=>scope.status!=='closed')??scopes.at(-1);
}
const sameStamp=(a:ScopeDetailStamp,b:ScopeDetailStamp)=>a.scopeId===b.scopeId&&a.streamId===b.streamId&&a.seq===b.seq;
/** 同一会话内同时提交图、周期摘要与详情；任意部分无效都保留上一组合，不显示半次响应。 */
export class SessionReadProjection {
  private graphs:SessionGraphProjection;
  private goals:SessionScopeProjection;
  private details=new Map<string,{stamp:ScopeDetailStamp;scope:PublicDispatchScope}>();
  constructor(readonly identity:GraphIdentity){this.graphs=new SessionGraphProjection(identity);this.goals=new SessionScopeProjection(identity)}
  get graph(){return this.graphs.snapshot}
  get scopes(){return this.goals.snapshot?.scopes}
  get graphCursor(){return this.graphs.cursor}
  get scopeCursor(){return this.goals.cursor}
  selected(id?:string){return id?this.scopes?.find(scope=>scope.scopeId===id):currentScope(this.scopes??[])}
  detailStamp(id?:string){const selected=this.selected(id);return selected?this.details.get(selected.scopeId)?.stamp:undefined}
  detail(id?:string){const selected=this.selected(id),cached=selected?this.details.get(selected.scopeId):undefined;return selected&&cached&&sameStamp(selected.stamp,cached.stamp)?cached.scope:undefined}
  apply(response:DispatchSessionRead,requestedScopeId?:string):void{
    const graphs=this.graphs.fork(),goals=this.goals.fork();graphs.apply(response.graph);goals.apply(response.scopes);
    if(goals.cursor!.streamId!=='scopes:'+graphs.cursor!.streamId)throw Error('任务图与目标记录来自不同事件流');
    const detail=response.detail,cache=new Map(this.details);
    if(detail.mode!=='empty'){
      const stamp=detail.stamp;
      if(stamp.streamId!==goals.cursor!.streamId||!Number.isSafeInteger(stamp.seq)||stamp.seq<1||requestedScopeId&&requestedScopeId!==stamp.scopeId)throw Error('目标详情与当前选择身份不一致');
      const prior=cache.get(stamp.scopeId);
      if(detail.mode==='updated'){
        const scope=detail.scope;
        if(scope.workspaceId!==this.identity.workspaceId||scope.rootSessionId!==this.identity.rootSessionId||scope.scopeId!==stamp.scopeId)throw Error('目标详情属于其他会话');
        if(prior&&prior.stamp.streamId===stamp.streamId&&prior.stamp.seq>stamp.seq)throw Error('目标详情版本回退');
        if(prior&&sameStamp(prior.stamp,stamp)){if(JSON.stringify(prior.scope)!==JSON.stringify(scope))throw Error('相同目标详情版本的内容不一致')}
        else {cache.delete(stamp.scopeId);cache.set(stamp.scopeId,{stamp,scope})}
      }else if(!prior||!sameStamp(prior.stamp,stamp))throw Error('目标详情无变化响应缺少本地版本');
      // 分页详情可以领先摘要；缓存到对应摘要追齐后才显示，不将不同版本拼在同一卡片。
      while(cache.size>8){const key=cache.keys().next().value!;if(key===stamp.scopeId)break;cache.delete(key)}
    }else if(requestedScopeId)throw Error('选中的目标详情缺失');
    for(const summary of goals.snapshot!.scopes){
      const cached=cache.get(summary.scopeId);if(!cached||!sameStamp(cached.stamp,summary.stamp))continue;
      const scope=cached.scope;
      if(scope.status!==summary.status||scope.outcome!==summary.outcome||scope.createdAt!==summary.createdAt||scope.closedAt!==summary.closedAt||Boolean(scope.goal)!==summary.hasGoal||scope.goal?.revision!==summary.goalRevision||Boolean(scope.goal?.plan)!==summary.hasPlan||scope.goal?.review?.decision!==summary.reviewDecision)throw Error('目标摘要与同版本详情不一致');
      if(summary.inputRevision!==undefined&&(scope.goal?.inputRevision??1)!==summary.inputRevision)throw Error('目标补充版本与同版本摘要不一致');
      if(scope.activeInputs!==undefined&&(!Array.isArray(scope.activeInputs)||!scope.activeInputs.length||scope.activeInputs.length>64||scope.activeInputs.some(item=>!scopeActiveInputSchema.safeParse(item).success)||new Set(scope.activeInputs.map(item=>item.insertionId)).size!==scope.activeInputs.length)||summary.activeInputStatus!==scopeActiveInputStatus(scope)||summary.activeInputCount!==(scope.activeInputs?.length||undefined))throw Error('运行内补充与同版本摘要不一致');
      if(summary.needsReplan!==undefined&&summary.needsReplan!==(!!scope.goal?.plan&&(scope.goal.plan.inputRevision??1)!==(scope.goal.inputRevision??1)))throw Error('目标计划输入版本与同版本摘要不一致');
      if(Boolean(scope.wait)!==Boolean(summary.wait)||scope.wait?.waitId!==summary.wait?.waitId||scope.wait?.goalRevision!==summary.wait?.goalRevision||scope.wait?.createdAt!==summary.wait?.createdAt)throw Error('目标等待记录与同版本摘要不一致');
      if(scope.goal&&(!scope.goal.input||typeof scope.goal.input.message!=='string'||!Array.isArray(scope.goal.input.attachmentIds)))throw Error('目标详情缺少原始输入');
    }
    this.graphs=graphs;this.goals=goals;this.details=cache;
  }
}
/** 两条增量流都追齐同一次读取屏障后才可发布；分页过程只推进内部游标，不能把新目标状态配上旧任务节点。 */
export function completeSessionRead(response:DispatchSessionRead,projection:SessionReadProjection,selectedScopeId?:string){
  if(response.graph.mode==='delta'&&response.graph.hasMore||response.scopes.mode==='delta'&&response.scopes.hasMore)return undefined;
  return {graph:projection.graph,scopes:projection.scopes??[],detail:projection.detail(selectedScopeId)};
}

/** 对话摘要和任务根共用的只读状态；当前周期与历史选择刻意分开。 */
export interface ScopeGoalState {
  scopes:readonly ScopeSummary[];
  selectedScopeId?:string;
  /** undefined 表示自动跟随，区别于 selectedScopeId 已解析出的实际周期 ID。 */
  historyScopeId?:string;
  selectedScope?:PublicDispatchScope;
  /** 当前未关闭目标，包含持久等待；决定发送入队与取消入口，不受历史选择影响。 */
  openScope?:ScopeSummary;
  /** 只有 active 表示调度仍在推进，waiting 不计入生成动画或工作时间。 */
  activeScope?:ScopeSummary;
  waitingScope?:ScopeSummary;
  selectedGoalView:GoalView;
  currentGoalView:GoalView;
  graph?:GraphSnapshot;
  loading:boolean;detailLoading:boolean;error:string;
  selectScope:(id?:string)=>void;
}
