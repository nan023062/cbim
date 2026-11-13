/**
 * 目录归属：backend/scheduler-engine/evidence；目标状态与核证恢复服务。
 * 作用定位：从已核对身份的成员运行日志提取工具授权与回执事实。
 * 设计原因：工具结束、运行终态和业务验收不能互相替代；以最小可信运行身份复用于成员报告及主核实证明，缺少授权链时保留未知，不从模型正文推断成功。
 * 范围边界：仓库操作及链接器须与完整授权/回执范围一致，外部只读不能降为工作区文件事实。
 * 兼容边界：原执行报告保持 128 字符调用 ID；原命令核实可显式采用真实工具已有的 512 字符域，不截断或改变旧报告协议。
 */
import {executionReportSchema,type ExecutionReport} from '../../../logic/tasks/rules/execution-report';
import type {RunSummary} from '../../../logic/execution/rules/types';
import type {DispatchRun} from '../../../logic/tasks/rules/dispatch-execution';
import {hash,json} from '../../../core/platform/node/serialization';
import {z} from 'zod';

type Item=ExecutionReport['tools']['items'][number];
const receiptSchema=executionReportSchema.shape.tools.shape.items.element.shape.receipt.unwrap();
const effectsSchema=executionReportSchema.shape.tools.shape.items.element.shape.effects;
const scopeSchema=executionReportSchema.shape.tools.shape.items.element.shape.scope;
const inputHash=(value:unknown)=>hash(JSON.stringify(value)??'undefined');
/** 回执必须来自本 run 且与工具授权匹配；不向界面返回任何未白名单校验的对象。 */
export function executionToolFacts(summary:RunSummary,run:{binding:Pick<DispatchRun['binding'],'workspaceId'|'taskId'|'runId'>},options?:{toolCallIdLimit:512}){
  // 原命令工具的可信 call 域允许 512；旧执行报告保持原 128 输出域，不靠截断关联不同调用。
  const callLimit=options?.toolCallIdLimit??128,checkedReceipt=options?receiptSchema.extend({toolCallId:z.string().min(1).max(callLimit)}):receiptSchema;
  const items=new Map<string,Item>(),invalid=new Set<string>(),gate=new Map<string,'allowed'|'denied'>(),inputs=new Map<string,string>();
  let orphan=false;
  const binding=run.binding;
  for(const event of summary.events){
    if(!['tool.proposed','tool.allowed','tool.denied','tool.started','tool.finished'].includes(event.type))continue;
    const data=event.data;
    if(!data||typeof data!=='object'||Array.isArray(data)){orphan=true;continue}
    const id=data.id,name=data.name;
    if(typeof id!=='string'||!id.length||id.length>callLimit||typeof name!=='string'||!name.length||name.length>512){orphan=true;continue}
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
      else {
        item.effects=effects.data;item.scope=scope.data;
        // 仓库只读范围必须与真实操作和调用参数对应；即使伪造的 allowed/receipt 彼此相等也不能改成另一来源。
        if(scope.data.kind==='repository'&&(name!==`cbim_repository_${scope.data.operation}`||(data.input as Record<string,unknown>|undefined)?.connectorId!==scope.data.connectorId||effects.data.length!==1||effects.data[0]!=='read')||event.type==='tool.allowed'&&name.startsWith('cbim_repository_')&&scope.data.kind!=='repository')invalid.add(id);
      }
      gate.set(id,event.type==='tool.allowed'?'allowed':'denied');
      if(event.type==='tool.allowed'){item.allowedSeq=event.seq;item.status='unknown'}
    }
    // Pi 的 started 表示尝试进入工具，可以早于 beforeTool；只有授权及真实结束回执才证明已放行。
    if(event.type==='tool.finished'||event.type==='tool.denied'){
      if(event.type==='tool.finished'&&item.finishedSeq!==undefined)invalid.add(id);
      const parsed=checkedReceipt.safeParse(data.receipt),receipt=parsed.success?parsed.data:undefined;
      const expected=gate.get(id);
      if(event.type==='tool.finished'&&expected==='allowed'&&receipt&&['succeeded','failed'].includes(receipt.outcome)&&receipt.outcome!==(data.isError?'failed':'succeeded'))invalid.add(id);
      if(!receipt||receipt.toolCallId!==id||receipt.toolName!==name||receipt.workspaceId!==binding.workspaceId||receipt.taskId!==binding.taskId||receipt.runId!==binding.runId||receipt.scope.workspaceId!==binding.workspaceId||receipt.inputHash!==inputs.get(id)||event.type==='tool.finished'&&receipt.resultHash!==(data.result===undefined?undefined:hash(JSON.stringify(data.result)))||json(receipt.effects)!==json(item.effects)||json(receipt.scope)!==json(item.scope)||!expected||(expected==='denied'?receipt.outcome!=='denied':!['succeeded','failed','unknown'].includes(receipt.outcome))){invalid.add(id);continue}
      item.receipt=receipt;item.status=receipt.outcome;
      if(event.type==='tool.finished')item.finishedSeq=event.seq;
    }
  }
  // 中断回执在 run.interrupted 上，由 canonical summary 归并；必须仍有本轮授权链。
  for(const raw of summary.toolReceipts??[]){
    const parsed=checkedReceipt.safeParse(raw),receipt=parsed.success?parsed.data:undefined;
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
