/**
 * 作用定位：模块知识治理写操作的有界本地待确认元数据，供面板卸载或应用重开后查询原命令。
 * 设计原因：先可靠保存身份再发送，未知结果不能被新命令覆盖；不复制知识正文或批准凭据，也不自动重发。
 * 职责边界：只维护本机查看状态，不签发决定。服务回执仍须由调用者严格核对，存储损坏或不可写时保留原记录并停止新写入。
 */
import {z} from 'zod';
import {moduleGovernanceReceiptSchema,moduleGovernanceUnacceptedSchema} from '../../bridge/contracts/governance';

export const governancePendingSchema=z.object({workspaceId:z.string().min(1),instanceId:z.string().uuid(),moduleId:z.string().min(1),commandId:z.string().uuid(),action:z.enum(['register','observe','propose','decide','apply']),expected:z.object({protectionId:z.string().uuid().optional(),observationId:z.string().uuid().optional(),proposalId:z.string().uuid().optional(),decisionId:z.string().uuid().optional(),basis:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().optional()}).strict();
export type GovernancePending=z.infer<typeof governancePendingSchema>;
export const GOVERNANCE_PENDING_KEY='cbim.module-governance.pending.v1';
const index=z.object({version:z.literal(1),records:z.array(governancePendingSchema).max(64)}).strict();
const equal=(a:GovernancePending,b:GovernancePending)=>JSON.stringify(a)===JSON.stringify(b);
/** 同步保存完成后才能调用 IPC；移除必须匹配原完整元数据，不能由迟到回执清除后来操作。 */
export function createGovernancePendingStore(storage:Pick<Storage,'getItem'|'setItem'>){
  const load=()=>{
    let raw:string|null;try{raw=storage.getItem(GOVERNANCE_PENDING_KEY)}catch{throw Error('无法读取治理待确认记录，请恢复本地存储；未发送新操作')}
    if(raw===null)return {version:1 as const,records:[] as GovernancePending[]};
    try{if(new TextEncoder().encode(raw).length>256*1024)throw Error('size');const data=index.parse(JSON.parse(raw));if(new Set(data.records.map(v=>v.workspaceId)).size!==data.records.length||new Set(data.records.map(v=>v.commandId)).size!==data.records.length)throw Error('duplicate');return data}catch{throw Error('治理待确认记录无效，原数据已保留；请先核实原命令')}
  };
  const write=(records:GovernancePending[])=>{
    const text=JSON.stringify(index.parse({version:1,records}));if(new TextEncoder().encode(text).length>256*1024)throw Error('治理待确认记录超过容量，请先核实原命令');
    try{storage.setItem(GOVERNANCE_PENDING_KEY,text)}catch{throw Error('无法保存治理待确认记录；未发送新命令或清除原记录')}
  };
  return {
    read(workspaceId:string){return load().records.find(v=>v.workspaceId===workspaceId)},
    save(raw:GovernancePending){const pending=governancePendingSchema.parse(raw),data=load(),old=data.records.find(v=>v.workspaceId===pending.workspaceId);if(old&&!equal(old,pending))throw Error('此工作区有尚未确认的治理操作，请先查询原命令');if(data.records.some(v=>v.commandId===pending.commandId&&v.workspaceId!==pending.workspaceId))throw Error('治理命令已属于另一个工作区');write(old?data.records:[...data.records,pending])},
    remove(raw:GovernancePending){const pending=governancePendingSchema.parse(raw),data=load(),old=data.records.find(v=>v.workspaceId===pending.workspaceId);if(!old)return;if(!equal(old,pending))throw Error('原治理请求已变化，迟到结果不能清除新请求');write(data.records.filter(v=>v.workspaceId!==pending.workspaceId))},
  };
}

/** 原回执须关联原命令和目标，不允许“当前已经改成这样”替代历史证明。 */
export function checkedGovernanceReceipt(raw:unknown,pending:GovernancePending){
  const receipt=moduleGovernanceReceiptSchema.parse(raw),record=receipt.record;
  if(receipt.identity.workspaceId!==pending.workspaceId||receipt.identity.instanceId!==pending.instanceId||receipt.commandId!==pending.commandId||receipt.action!==pending.action||record.workspaceId!==pending.workspaceId)throw Error('治理回执与原命令身份不一致，请核实原命令');
  const recordId=receipt.action==='register'?receipt.record.protectionId:receipt.action==='observe'?receipt.record.observationId:receipt.action==='propose'?receipt.record.proposalId:receipt.action==='decide'?receipt.record.decisionId:receipt.record.intentId;
  if(recordId!==pending.commandId)throw Error('治理实体不是原命令产生的记录');
  if(receipt.action==='apply'&&(receipt.record.requestId!==pending.commandId||receipt.record.state==='committed'&&(receipt.record.result.requestId!==pending.commandId||receipt.record.result.workspaceId!==pending.workspaceId||receipt.record.result.instanceId!==pending.instanceId)))throw Error('原知识事务回执与治理实施身份不一致');
  if('moduleId' in record&&record.moduleId!==pending.moduleId)throw Error('治理回执模块不匹配');
  for(const [key,value]of Object.entries(pending.expected??{}))if(value!==undefined&&(record as Record<string,unknown>)[key]!==value)throw Error('治理回执目标或依据不匹配');
  return receipt;
}
/** 只有服务对原退役实例作出的肯定证明可解除；没有回执或同名新命令均不能替代。 */
export function checkedGovernanceUnaccepted(raw:unknown,pending:GovernancePending){
  const result=moduleGovernanceUnacceptedSchema.parse(raw);
  if(result.identity.workspaceId!==pending.workspaceId||result.identity.instanceId!==pending.instanceId||result.commandId!==pending.commandId||result.action!==pending.action||!result.unaccepted)throw Error('尚不能证明原治理命令未受理，待确认记录继续保留');
  return result;
}

/** 仅用于第一次 RPC 的明确预受理拒绝；已未知、恢复查询、接受回执或后续刷新失败时禁止调用此判定解除记录。 */
export function isFirstGovernanceRejection(error:unknown){
  const text=error instanceof Error?error.message:String(error),code=/^(?:Error: )?([A-Z][A-Z_]+):/.exec(text)?.[1];
  return code!==undefined&&new Set(['GOVERNANCE_INPUT','GOVERNANCE_IDENTITY','GOVERNANCE_PROTECTION','GOVERNANCE_EXISTS','GOVERNANCE_SOURCE','GOVERNANCE_OBSERVATION','GOVERNANCE_PROPOSAL','GOVERNANCE_STALE','GOVERNANCE_DRIFT','GOVERNANCE_VALIDATION','GOVERNANCE_PROTECTED','GOVERNANCE_DECISION','GOVERNANCE_LIMIT','GOVERNANCE_INTENT','STALE_INSTANCE','NOT_RUNNING','SHUTTING_DOWN']).has(code);
}
