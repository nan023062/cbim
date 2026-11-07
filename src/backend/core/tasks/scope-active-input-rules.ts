/**
 * 作用定位：校验运行中补充的可靠尝试、唯一结算和目标增版，供事务提交与重放共用。
 * 设计原因：UI/Runtime 不能凭回包跳过持久 pending；接受后才增加输入版本，未知结果不能被普通聊天例外或新计划洗掉。
 * 职责边界：这里只核已保存结构及正文指纹，真实 queued/日志证据由调度服务核实；不启动模型，不重写旧运行。
 */
import {fail} from '../foundation/errors';
import {hash,json} from '../foundation/serialization';
import type {DispatchState,DispatchMutation} from './dispatch-storage';
import {goalInputRevision,goalNeedsReplan,sameGoalValue} from './scope-goal';
import {scopeContinuationTotalTextLimit} from './scope-continuation';
import {isHumanContinuation} from './scope-continuation-record';
import {scopeActiveInputSchema,scopeActiveInputLimits,scopeHasUnresolvedActiveInput,type ScopeActiveInput,type ScopeActiveInputPayload} from './scope-active-input';

/** 只供后端计算实际待发送正文指纹；缺省附件与空数组同义，不包含路径、密钥或模型选项。 */
export function scopedActiveInputHash(input:ScopeActiveInputPayload):string{return hash(json({message:input.message,attachmentIds:input.attachmentIds??[]}))}
function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
function fixed(value:ScopeActiveInput){const {insertionId,queueId,runId,preparedAt,baseGoalRevision,baseInputRevision,inputHash,messageBytes,messageCharacters,attachmentIds}=value;return {insertionId,queueId,runId,preparedAt,baseGoalRevision,baseInputRevision,inputHash,messageBytes,messageCharacters,...(attachmentIds===undefined?{}:{attachmentIds})}}

/** 返回本次真实接受的周期；调用者据此启用精确 active 增版转换，不能当成通用 supplement 豁免。 */
export function validateScopeActiveInputs(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):Set<string>{
  const accepted=new Set<string>(),ids=new Set<string>();
  for(const scope of next.scopes??[]){
    const old=previous.scopes?.find(item=>item.scopeId===scope.scopeId),before=old?.activeInputs??[],after=scope.activeInputs??[];
    valid(after.length<=scopeActiveInputLimits.attempts&&after.length>=before.length&&after.length<=before.length+1&&(!old?.activeInputs||scope.activeInputs!==undefined),'运行补充历史只能追加且不能删除');
    let changed=0;
    const queues=new Set<string>(),acceptedSeqs=new Map<string,number>();
    for(const [index,item] of after.entries()){
      valid(scopeActiveInputSchema.safeParse(item).success&&!ids.has(item.insertionId),'运行补充身份重复或结构无效');ids.add(item.insertionId);
      const queueKey=JSON.stringify([item.runId,item.queueId]);
      valid(!queues.has(queueKey),'同一运行的队列消息不能重复登记补充');queues.add(queueKey);
      valid(item.insertionId===hash(json({scopeId:scope.scopeId,runId:item.runId,queueId:item.queueId})),'插入身份必须对应原周期、运行和队列消息');
      valid(scope.goal&&scope.runTracking?.mainRunIds.includes(item.runId)&&!next.runs?.some(run=>run.binding.runId===item.runId),'运行补充必须引用本周期已登记主运行');
      valid(Date.parse(item.preparedAt)>=Date.parse(scope.createdAt)&&item.baseGoalRevision<=scope.goal.revision&&item.baseInputRevision<=goalInputRevision(scope.goal),'补充准备版本或时间超出周期');
      if(item.status==='accepted'){
        valid(item.inputHash===scopedActiveInputHash(item.input)&&item.goalRevision<=scope.goal.revision,'接收正文或目标版本不属于原准备记录');
        valid(item.requestedSeq>(acceptedSeqs.get(item.runId)??0),'同一运行的接受记录不能重用或倒退日志序号');acceptedSeqs.set(item.runId,item.acceptedSeq);
      }
      const prior=before[index];
      if(prior){
        if(sameGoalValue(prior,item))continue;
        changed++;
        valid(prior.status==='pending'&&item.status!=='pending'&&sameGoalValue(fixed(prior),fixed(item)),'补充只能从 pending 结算一次，固定身份与正文指纹不能改写');
        valid(old?.status==='active','只能结算仍活动周期的插入');
        if(item.status==='accepted'){
          valid(old.goal&&!old.goal.blocked&&item.baseGoalRevision===old.goal.revision&&item.baseInputRevision===goalInputRevision(old.goal),'接受前的目标版本已经变化');
          accepted.add(scope.scopeId);
        }
      }else{
        changed++;
        valid(old?.status==='active'&&scope.status==='active'&&old.goal&&!old.goal.blocked&&!old.budget?.blocked&&item.status==='pending'&&!scopeHasUnresolvedActiveInput(old),'只能为活动目标准备一个新的运行补充');
        valid(old.runTracking?.mainRunIds.at(-1)===item.runId&&item.baseGoalRevision===old.goal.revision&&item.baseInputRevision===goalInputRevision(old.goal),'准备必须固定当前主运行及目标输入版本');
        valid(item.baseInputRevision<32&&item.baseGoalRevision+3<=65,'补充必须预留输入及后续规划审阅额度');
      }
    }
    valid(after.filter(item=>item.status==='pending').length<=1,'同一周期不能并行准备多次插入');
    const text=(scope.continuations??[]).reduce((sum,item)=>sum+(isHumanContinuation(item)?0:item.input.message.length),0)+after.reduce((sum,item)=>sum+(item.status==='rejected'?0:item.messageCharacters),0);
    valid(text<=scopeContinuationTotalTextLimit,'补充正文与待发送预留合计超过允许大小');
    if(changed){
      valid(changed===1&&mutation.scopes?.length===1&&!mutation.batch&&!mutation.members?.length&&!mutation.sessions?.length&&!mutation.runs?.length&&!mutation.messages?.length,'插入准备或结算只能修改一个周期，不夹带运行或任务变更');
      valid(old&&sameGoalValue({...old,activeInputs:scope.activeInputs,goal:scope.goal},scope),'插入不能改变周期状态、等待、原运行或权限');
      if(!accepted.has(scope.scopeId))valid(sameGoalValue(old.goal,scope.goal),'未确认接受的插入不能改变目标');
    }
    if(scopeHasUnresolvedActiveInput(scope)){
      valid(scope.status!=='waiting'&&!(scope.status==='closed'&&scope.outcome==='completed'),'未核实插入不能安全等待或完成');
      if(old&&(!sameGoalValue(old.goal?.plan,scope.goal?.plan)||!sameGoalValue(old.goal?.review,scope.goal?.review)))valid(false,'未核实插入不能通过新计划或审阅绕过');
      // cause 是批次说明，不是新增事实；只封锁当前活动周期，旧 unknown 不得阻断同根新周期。
      if(scope.status==='active'){
        const priorTasks=new Set(previous.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.map(task=>task.taskId)??[]);
        valid(!next.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.some(task=>!priorTasks.has(task.taskId)),'未核实插入不能派发新任务');
        valid(!(mutation.runs??[]).some(run=>run.binding.rootSessionId===scope.rootSessionId&&!previous.runs?.some(prior=>prior.binding.runId===run.binding.runId)),'未核实插入不能领取新成员运行');
      }
      if(old)valid(sameGoalValue(old.runTracking,scope.runTracking),'未核实插入不能登记另一个主运行');
    }
    if(scope.goal&&goalNeedsReplan(scope.goal))valid(scope.status!=='closed'||scope.outcome!=='completed','新输入尚未重新规划，不能沿旧计划完成');
    if(scope.goal&&goalNeedsReplan(scope.goal))valid(!(mutation.runs??[]).some(run=>run.binding.rootSessionId===scope.rootSessionId&&next.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.some(task=>task.taskId===run.binding.taskId&&task.scopeId===scope.scopeId)&&!previous.runs?.some(prior=>prior.binding.runId===run.binding.runId)),'输入尚未重新规划，不能领取新成员运行');
  }
  return accepted;
}
