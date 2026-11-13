/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 作用定位：在派发事务中登记运行中插入的准备、真实接收和不确定事实。
 * 设计原因：发送前先占用输入额度，确认后才提升目标版本；原生发送与磁盘事务不冒称原子，失败保留原尝试且不重放。
 * 职责边界：input.message 是实际发送的队列快照，可能含附件展开资料；不重建用户原文、不改变原始 goal.input 或模型权限。
 */
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {DispatchState,DispatchStore} from '../../../logic/dispatch/rules/dispatch-storage';
import type {DispatchScope} from '../../../logic/tasks/rules/dispatch-scope';
import type {GraphIdentity} from '../../../logic/tasks/rules/graph-types';
import {goalInputRevision,scopeGoalDecisionLimit,sameGoalValue} from '../../../logic/tasks/rules/scope-goal';
import {isHumanContinuation} from '../../../logic/tasks/rules/scope-continuation-record';
import {scopeActiveInputLimits,scopeActiveInputPayloadSchema,scopeActiveInputSendReceiptSchema,scopeHasUnresolvedActiveInput,type ScopeActiveInput,type ScopeActiveInputPayload,type ScopeActiveInputToken,type ScopeActiveInputSendReceipt} from '../../../logic/tasks/rules/scope-active-input';
import {scopedActiveInputHash} from '../../../logic/tasks/rules/scope-active-input-rules';

type Owner=Pick<KnowledgeWorkspace,'entry'|'assert'>;
function check(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
/** token 只能由本服务创建；fresh 不持久化，重查绝不重新取得发送权。 */
export interface PreparedActiveInput {record:ScopeActiveInput;token:ScopeActiveInputToken;fresh:boolean}
export class ScopeActiveInputService {
  constructor(private readonly owner:Owner,private readonly store:DispatchStore){}
  private scope(state:DispatchState,identity:GraphIdentity,scopeId:string){
    this.owner.assert();check(state.workspaceId===identity.workspaceId&&identity.workspaceId===this.owner.entry.id,'GOAL_ACTIVE_INPUT_IDENTITY','补充不属于当前工作区');
    const scope=state.scopes?.find(item=>item.scopeId===scopeId&&item.workspaceId===identity.workspaceId&&item.rootSessionId===identity.rootSessionId);
    check(scope,'GOAL_ACTIVE_INPUT_IDENTITY','补充不属于当前主会话周期');return scope;
  }
  /** 按原 run/queue 查询所有周期，不读取附件、发送消息或推测失败记录可重试。 */
  async inspect(identity:GraphIdentity,runId:string,queueId:string):Promise<ScopeActiveInput|undefined>{
    this.owner.assert();check(identity.workspaceId===this.owner.entry.id,'GOAL_ACTIVE_INPUT_IDENTITY','补充不属于当前工作区');
    const state=await this.store.read(),records=state.scopes?.filter(scope=>scope.workspaceId===identity.workspaceId&&scope.rootSessionId===identity.rootSessionId).flatMap(scope=>(scope.activeInputs??[]).filter(item=>item.runId===runId&&item.queueId===queueId))??[];
    check(records.length<=1,'GOAL_ACTIVE_INPUT_IDENTITY','原插入身份存在冲突');return records[0];
  }
  /** 事务返回前不得发送；pending 不修改目标，只预留版本/正文并阻止旧计划继续推进。 */
  async prepare(identity:GraphIdentity,scopeId:string,runId:string,queueId:string,raw:ScopeActiveInputPayload,signal:AbortSignal):Promise<PreparedActiveInput>{
    const parsed=scopeActiveInputPayloadSchema.safeParse(raw);check(parsed.success,'GOAL_ACTIVE_INPUT_INVALID','输入快照为空、超限或附件身份无效');
    const input=structuredClone(parsed.data),inputHash=scopedActiveInputHash(input),insertionId=hash(json({scopeId,runId,queueId})),token={scopeId,insertionId,queueId,runId,inputHash};
    const observed=this.scope(await this.store.read(),identity,scopeId),prior=observed.activeInputs?.find(item=>item.queueId===queueId&&item.runId===runId);
    if(prior){check(prior.insertionId===insertionId&&prior.inputHash===inputHash,'GOAL_ACTIVE_INPUT_CONFLICT','原队列身份已绑定不同运行或输入快照');return {record:prior,token,fresh:false}}
    const messageBytes=Buffer.byteLength(input.message,'utf8'),messageCharacters=input.message.length;
    const alive=()=>{this.owner.assert();if(signal.aborted)fail('QUEUE_INSERT_STOPPED','当前运行已停止插入，原消息仍保留在队列')};
    let fresh=false;
    const record=await this.store.transact<ScopeActiveInput>({commandId:'active-input-prepare-'+insertionId,fingerprint:hash(json({identity,token,input}))},async state=>{
      const scope=this.scope(state,identity,scopeId),existing=scope.activeInputs?.find(item=>item.insertionId===insertionId);
      if(existing){check(existing.inputHash===inputHash,'GOAL_ACTIVE_INPUT_CONFLICT','原插入请求已绑定其他输入快照');return {receipt:existing}}
      alive();const goal=scope.goal;
      check(scope.status==='active'&&goal&&!goal.blocked&&!scope.budget?.blocked,'GOAL_ACTIVE_INPUT_UNAVAILABLE','原目标已结束或阻塞，原消息仍保留在队列');
      check(scope.runTracking?.mainRunIds.at(-1)===runId,'QUEUE_INSERT_STALE','原主运行已变化，原消息仍保留在队列');
      check(!scopeHasUnresolvedActiveInput(scope),'GOAL_ACTIVE_INPUT_UNRESOLVED','原补充仍未核实，不能再次发送');
      check((scope.activeInputs?.length??0)<scopeActiveInputLimits.attempts&&goalInputRevision(goal)<scopeActiveInputLimits.inputs,'GOAL_ACTIVE_INPUT_LIMIT','目标补充次数已达到上限，原消息仍保留在队列');
      check(goal.revision+3<=scopeGoalDecisionLimit+1,'GOAL_DECISION_LIMIT','剩余目标版本不足以接收补充并重新规划审阅');
      const text=(scope.continuations??[]).reduce((total,item)=>total+(isHumanContinuation(item)?0:item.input.message.length),0)+(scope.activeInputs??[]).reduce((total,item)=>total+(item.status==='rejected'?0:item.messageCharacters),0);
      check(messageBytes<=scopeActiveInputLimits.messageBytes&&text+messageCharacters<=scopeActiveInputLimits.totalText,'GOAL_ACTIVE_INPUT_LIMIT','输入快照或目标补充正文累计超限，尚未发送');
      const pending:ScopeActiveInput={insertionId,queueId,runId,inputHash,preparedAt:new Date().toISOString(),baseGoalRevision:goal.revision,baseInputRevision:goalInputRevision(goal),messageBytes,messageCharacters,...(input.attachmentIds?{attachmentIds:input.attachmentIds}:{}),status:'pending'};
      alive();fresh=true;return {scopes:[{...scope,activeInputs:[...(scope.activeInputs??[]),pending]}],receipt:pending};
    });
    return {record,token,fresh};
  }
  /** ACK 后取消不能撤销接收；只改变原 pending，重复结果返回同一事实，失败不自动重发。 */
  async resolve(identity:GraphIdentity,token:ScopeActiveInputToken,outcome:{status:'accepted';input:ScopeActiveInputPayload;receipt:ScopeActiveInputSendReceipt}|{status:'rejected'|'unknown';reason:string}):Promise<ScopeActiveInput>{
    const fixed=structuredClone({token,outcome});
    token=fixed.token;outcome=fixed.outcome;identity=structuredClone(identity);
    return this.store.transact({commandId:'active-input-resolve-'+token.insertionId,fingerprint:hash(json(fixed))},async state=>{
      const scope=this.scope(state,identity,token.scopeId),record=scope.activeInputs?.find(item=>item.insertionId===token.insertionId);
      check(record&&record.queueId===token.queueId&&record.runId===token.runId&&record.inputHash===token.inputHash,'GOAL_ACTIVE_INPUT_IDENTITY','补充结果缺少原准备记录');
      check(scope.status==='active','GOAL_ACTIVE_INPUT_CLOSED','原周期已封存，不能补造接收结果');
      if(record.status!=='pending'){check(record.status===outcome.status,'GOAL_ACTIVE_INPUT_CONFLICT','原插入已有不同结算结果');return {receipt:record}}
      let next:ScopeActiveInput,goal=scope.goal;
      if(outcome.status==='accepted'){
        const parsed=scopeActiveInputSendReceiptSchema.safeParse(outcome.receipt);
        check(parsed.success&&sameGoalValue({...token,requestedSeq:parsed.data.requestedSeq,acceptedSeq:parsed.data.acceptedSeq},parsed.data)&&scopedActiveInputHash(outcome.input)===token.inputHash,'GOAL_ACTIVE_INPUT_PROOF','接收日志与原插入快照不一致');
        check(goal&&goal.revision===record.baseGoalRevision&&goalInputRevision(goal)===record.baseInputRevision,'GOAL_ACTIVE_INPUT_STALE','补充准备后的目标版本已变化，接收事实需要核实');
        const {review:_stale,...original}=goal;goal={...original,revision:goal.revision+1,inputRevision:goalInputRevision(goal)+1};
        next={...record,status:'accepted',acceptedAt:new Date().toISOString(),inputRevision:goalInputRevision(goal),goalRevision:goal.revision,input:structuredClone(outcome.input),requestedSeq:parsed.data.requestedSeq,acceptedSeq:parsed.data.acceptedSeq};
      }else next={...record,status:outcome.status,resolvedAt:new Date().toISOString(),reason:outcome.reason};
      return {scopes:[{...scope,goal,activeInputs:scope.activeInputs!.map(item=>item.insertionId===token.insertionId?next:item)}],receipt:next};
    });
  }
}
