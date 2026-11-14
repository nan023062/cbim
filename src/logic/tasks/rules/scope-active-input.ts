/**
 * 作用定位：运行中用户补充的持久尝试、可信发送令牌及公开输入版本关系。
 * 设计原因：原生排队与目标受理分开记录；未知发送不能沿旧审阅完成，等待续接仍保持自己的检查点和新运行身份。
 * 职责边界：纯叶子协议供桌面和后端共用，不读文件、不计算授权，也不把排入原生运行解释为模型已经处理或业务验收。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';

/** 正文字符沿等待补充的累计额度；UTF-8 字节另有单次上限，尝试历史独立有界。 */
export const scopeActiveInputLimits={attempts:64,inputs:32,messageBytes:512*1024,totalText:256_000} as const;
const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const hash=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().safe();
const attachmentIds=z.array(z.string().uuid()).max(12).refine(ids=>new Set(ids).size===ids.length);
export const scopeActiveInputPayloadSchema=z.object({message:z.string().min(1).max(scopeActiveInputLimits.totalText).refine(value=>!!value.trim()),attachmentIds:attachmentIds.optional()}).strict();
export type ScopeActiveInputPayload=z.infer<typeof scopeActiveInputPayloadSchema>;
/** 仅可信调度传入 Runtime，公开插入请求及模型工具不能指定这些绑定。 */
export const scopeActiveInputTokenSchema=z.object({scopeId:id,insertionId:hash,queueId:id,runId:id,inputHash:hash}).strict();
export type ScopeActiveInputToken=z.infer<typeof scopeActiveInputTokenSchema>;
/** 只有 queued 回复及其接受事件可靠保存后才返回；序号属于令牌指定的原运行。 */
export const scopeActiveInputSendReceiptSchema=scopeActiveInputTokenSchema.extend({requestedSeq:positive,acceptedSeq:positive}).strict().refine(value=>value.acceptedSeq>value.requestedSeq);
export type ScopeActiveInputSendReceipt=z.infer<typeof scopeActiveInputSendReceiptSchema>;
const base={insertionId:hash,queueId:id,runId:id,preparedAt:z.string().datetime(),baseGoalRevision:positive.max(65),baseInputRevision:positive.max(32),inputHash:hash,messageBytes:positive.max(scopeActiveInputLimits.messageBytes),messageCharacters:positive.max(scopeActiveInputLimits.totalText),attachmentIds:attachmentIds.optional()};
const resolved={resolvedAt:z.string().datetime(),reason:z.string().min(1).max(2000)};
export const scopeActiveInputSchema=z.discriminatedUnion('status',[
  z.object({...base,status:z.literal('pending')}).strict(),
  z.object({...base,status:z.literal('accepted'),acceptedAt:z.string().datetime(),inputRevision:positive.min(2).max(32),goalRevision:positive.max(65),input:scopeActiveInputPayloadSchema,requestedSeq:positive,acceptedSeq:positive}).strict(),
  z.object({...base,status:z.literal('rejected'),...resolved}).strict(),
  z.object({...base,status:z.literal('unknown'),...resolved}).strict(),
]).superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  const at=value.status==='pending'?value.preparedAt:value.status==='accepted'?value.acceptedAt:value.resolvedAt;
  if(Date.parse(at)<Date.parse(value.preparedAt))issue('插入结算不能早于准备');
  if(value.status==='accepted'){
    if(value.inputRevision!==value.baseInputRevision+1||value.goalRevision!==value.baseGoalRevision+1||value.acceptedSeq<=value.requestedSeq)issue('接受版本或日志序号无效');
    if(value.messageCharacters!==value.input.message.length||value.messageBytes!==new TextEncoder().encode(value.input.message).byteLength||JSON.stringify(value.attachmentIds??[])!==JSON.stringify(value.input.attachmentIds??[]))issue('接受正文与准备的大小或附件身份不一致');
  }
});
export type ScopeActiveInput=z.infer<typeof scopeActiveInputSchema>;
export type AcceptedScopeActiveInput=Extract<ScopeActiveInput,{status:'accepted'}>;

/** undefined 表示没有未核实输入，不表示业务完成；unknown 优先于仍在等待回执的 pending。 */
export function scopeActiveInputStatus(scope:{activeInputs?:readonly ScopeActiveInput[]}):'pending'|'unknown'|undefined{
  if(scope.activeInputs?.some(item=>item.status==='unknown'))return 'unknown';
  if(scope.activeInputs?.some(item=>item.status==='pending'))return 'pending';
}
export function scopeHasUnresolvedActiveInput(scope:{activeInputs?:readonly ScopeActiveInput[]}):boolean{return scopeActiveInputStatus(scope)!==undefined}

/** 两种历史只按实际输入版本合并，不按时间猜顺序；旧无 activeInputs 等同原等待续接规则。 */
export function validateScopeInputHistory(scope:{goal?:{inputRevision?:number};continuations?:readonly {inputRevision:number}[];activeInputs?:readonly ScopeActiveInput[]}):void{
  const revisions=[...(scope.continuations??[]).map(item=>item.inputRevision),...(scope.activeInputs??[]).filter((item):item is AcceptedScopeActiveInput=>item.status==='accepted').map(item=>item.inputRevision)].sort((a,b)=>a-b);
  if(revisions.length>=scopeActiveInputLimits.inputs||revisions.some((revision,index)=>revision!==index+2)||revisions.length&&!scope.goal||scope.goal&&(scope.goal.inputRevision??1)!==revisions.length+1)fail('GRAPH_INPUT_INVALID','输入版本必须对应连续且有界的真实接收历史');
  for(let index=1;index<(scope.continuations?.length??0);index++)if(scope.continuations![index].inputRevision<=scope.continuations![index-1].inputRevision)fail('GRAPH_INPUT_INVALID','等待接续输入版本不能倒退');
  const active=scope.activeInputs??[];
  for(const [index,item] of active.entries()){
    const prior=active[index-1];
    if(prior&&(item.baseInputRevision<(prior.status==='accepted'?prior.inputRevision:prior.baseInputRevision)||item.baseGoalRevision<(prior.status==='accepted'?prior.goalRevision:prior.baseGoalRevision)))fail('GRAPH_INPUT_INVALID','运行补充的准备版本不能倒退');
    if((item.status==='pending'||item.status==='unknown')&&(index!==active.length-1||item.baseInputRevision!==(scope.goal?.inputRevision??1)))fail('GRAPH_INPUT_INVALID','未核实补充之后不能继续消费输入');
  }
}
