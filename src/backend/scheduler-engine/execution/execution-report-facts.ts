/**
 * 作用定位：从已核对身份的成员运行日志提取工具授权与回执事实。
 * 设计原因：工具结束、运行终态和业务验收不能互相替代；以最小可信运行身份复用于成员报告及主核实证明，缺少授权链时保留未知，不从模型正文推断成功。
 */
import {executionReportSchema,type ExecutionReport} from '../../core/tasks/execution-report';
import type {RunSummary} from '../../core/brain/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import {hash,json} from '../../core/foundation/serialization';

type Item=ExecutionReport['tools']['items'][number];
const receiptSchema=executionReportSchema.shape.tools.shape.items.element.shape.receipt.unwrap();
const effectsSchema=executionReportSchema.shape.tools.shape.items.element.shape.effects;
const scopeSchema=executionReportSchema.shape.tools.shape.items.element.shape.scope;
const inputHash=(value:unknown)=>hash(JSON.stringify(value)??'undefined');
/** 回执必须来自本 run 且与工具授权匹配；不向界面返回任何未白名单校验的对象。 */
export function executionToolFacts(summary:RunSummary,run:{binding:Pick<DispatchRun['binding'],'workspaceId'|'taskId'|'runId'>}){
  const items=new Map<string,Item>(),invalid=new Set<string>(),gate=new Map<string,'allowed'|'denied'>(),inputs=new Map<string,string>();
  let orphan=false;
  const binding=run.binding;
  for(const event of summary.events){
    if(!['tool.proposed','tool.allowed','tool.denied','tool.started','tool.finished'].includes(event.type))continue;
    const data=event.data;
    if(!data||typeof data!=='object'||Array.isArray(data)){orphan=true;continue}
    const id=data.id,name=data.name;
    if(typeof id!=='string'||!id.length||id.length>128||typeof name!=='string'||!name.length||name.length>512){orphan=true;continue}
    let item=items.get(id);
    if(!item){item={toolCallId:id,toolName:name,status:'not_authorized',effects:[],scope:{kind:'unknown',workspaceId:binding.workspaceId}};items.set(id,item)}
    if(item.toolName!==name){invalid.add(id);continue}
    if(event.type==='tool.proposed'){
      if(item.proposedSeq!==undefined)invalid.add(id);
      item.proposedSeq=event.seq;inputs.set(id,inputHash(data.input));
      if(!data.input||typeof data.input!=='object'||Array.isArray(data.input))invalid.add(id);
    }
    if(event.type==='tool.allowed'||event.type==='tool.denied'){
      if(item.proposedSeq===undefined||item.proposedSeq>=event.seq)invalid.add(id);
      // stop 可在 allowed 后登记 denied，但不允许重复放行或任意改写本次调用。
      if(item.finishedSeq!==undefined||gate.has(id)&&!(gate.get(id)==='allowed'&&event.type==='tool.denied')||inputs.get(id)!==inputHash(data.input))invalid.add(id);
      const effects=effectsSchema.safeParse(data.effects??[]),scope=scopeSchema.safeParse(data.scope??{kind:'unknown',workspaceId:binding.workspaceId});
      if(!effects.success||!scope.success||scope.data.workspaceId!==binding.workspaceId)invalid.add(id);
      else {item.effects=effects.data;item.scope=scope.data}
      gate.set(id,event.type==='tool.allowed'?'allowed':'denied');
      if(event.type==='tool.allowed'){item.allowedSeq=event.seq;item.status='unknown'}
    }
    // Pi 的 started 表示尝试进入工具，可以早于 beforeTool；只有授权及真实结束回执才证明已放行。
    if(event.type==='tool.finished'||event.type==='tool.denied'){
      if(event.type==='tool.finished'&&item.finishedSeq!==undefined)invalid.add(id);
      const parsed=receiptSchema.safeParse(data.receipt),receipt=parsed.success?parsed.data:undefined;
      const expected=gate.get(id);
      if(event.type==='tool.finished'&&expected==='allowed'&&receipt&&['succeeded','failed'].includes(receipt.outcome)&&receipt.outcome!==(data.isError?'failed':'succeeded'))invalid.add(id);
      if(!receipt||receipt.toolCallId!==id||receipt.toolName!==name||receipt.workspaceId!==binding.workspaceId||receipt.taskId!==binding.taskId||receipt.runId!==binding.runId||receipt.scope.workspaceId!==binding.workspaceId||receipt.inputHash!==inputs.get(id)||event.type==='tool.finished'&&receipt.resultHash!==(data.result===undefined?undefined:hash(JSON.stringify(data.result)))||json(receipt.effects)!==json(item.effects)||json(receipt.scope)!==json(item.scope)||!expected||(expected==='denied'?receipt.outcome!=='denied':!['succeeded','failed','unknown'].includes(receipt.outcome))){invalid.add(id);continue}
      item.receipt=receipt;item.status=receipt.outcome;
      if(event.type==='tool.finished')item.finishedSeq=event.seq;
    }
  }
  // 中断回执在 run.interrupted 上，由 canonical summary 归并；必须仍有本轮授权链。
  for(const raw of summary.toolReceipts??[]){
    const parsed=receiptSchema.safeParse(raw),receipt=parsed.success?parsed.data:undefined;
    const item=receipt?items.get(receipt.toolCallId):undefined;
    if(!receipt||!item||receipt.workspaceId!==binding.workspaceId||receipt.taskId!==binding.taskId||receipt.runId!==binding.runId||receipt.toolName!==item.toolName||receipt.inputHash!==inputs.get(receipt.toolCallId)||receipt.scope.workspaceId!==binding.workspaceId||json(receipt.effects)!==json(item.effects)||json(receipt.scope)!==json(item.scope)){orphan=true;continue}
    if(receipt.outcome==='unknown'&&gate.get(receipt.toolCallId)==='allowed'){item.receipt=receipt;item.status='unknown'}
    else if(!item.receipt||json(item.receipt)!==json(receipt))invalid.add(receipt.toolCallId);
  }
  for(const id of summary.unresolvedTools){const item=items.get(id);if(item)item.status='unknown';else orphan=true}
  for(const id of invalid){const item=items.get(id);if(item){item.status='unknown';delete item.receipt}}
  const result=[...items.values()],counts={succeeded:0,failed:0,denied:0,unknown:0,not_authorized:0};
  for(const item of result)counts[item.status]++;
  return {items:result,counts,invalid:orphan||invalid.size>0,explicitUnknown:result.some(item=>item.receipt?.outcome==='unknown')};
}
