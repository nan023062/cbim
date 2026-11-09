/**
 * 作用定位：资源仓库连接写请求的本地待确认记录与严格回执匹配，供链接器界面跨卸载、重开核对原请求。
 * 设计原因：先保存小体积冻结请求再发送；未知结果不能因页面重建、存储失败或迟到回执而被换成新命令。
 * 职责边界：本模块不调用 IPC、不自动查询或重试。记录只含公开身份、版本与指纹；校验回执不是身份认证或业务验收。
 */
import {z} from 'zod';
import {
  repositoryConnectionCommitInputSchema,repositoryConnectionCommitSchema,
  repositoryConnectionGrantInputSchema,repositoryConnectionRevokeInputSchema,repositoryConnectionGrantSchema,repositoryConnectionReceiptSchema,
  repositoryConnectionUnacceptedSchema,
} from '../../bridge/contracts/repository-connections';
import type {RepositoryConnectionCommit,RepositoryConnectionReceipt} from '../../bridge/contracts/repository-connections';

const repositoryExpected=repositoryConnectionGrantSchema.pick({repositoryId:true,definitionHash:true}).strict();
/** 撤销固定原授权的仓库/定义指纹，不能用此刻列表的新定义替换；登记不持久化完整 preview。 */
export const repositoryConnectionPendingSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('grant'),input:repositoryConnectionGrantInputSchema}).strict(),
  z.object({action:z.literal('revoke'),input:repositoryConnectionRevokeInputSchema,expected:repositoryExpected}).strict(),
  z.object({action:z.literal('commit'),input:repositoryConnectionCommitInputSchema,expected:repositoryExpected.extend({connectorId:repositoryConnectionGrantSchema.shape.connectorId}).strict()}).strict(),
]);
export type RepositoryConnectionPending=z.infer<typeof repositoryConnectionPendingSchema>;
export type RepositoryConnectionCommitPending=Extract<RepositoryConnectionPending,{action:'commit'}>;
export type RepositoryConnectionGrantPending=Exclude<RepositoryConnectionPending,RepositoryConnectionCommitPending>;

export const REPOSITORY_CONNECTION_PENDING_KEY='cbim.repository-connections.pending.v1';
export const REPOSITORY_CONNECTION_PENDING_LIMIT=64,REPOSITORY_CONNECTION_PENDING_BYTES=256*1024;
const pendingIndex=z.object({version:z.literal(1),records:z.array(repositoryConnectionPendingSchema).max(REPOSITORY_CONNECTION_PENDING_LIMIT)}).strict();
type PendingStorage=Pick<Storage,'getItem'|'setItem'>;
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const pendingId=(pending:RepositoryConnectionPending)=>pending.action==='commit'?pending.input.planId:pending.input.commandId;
const same=(a:RepositoryConnectionPending,b:RepositoryConnectionPending)=>JSON.stringify(a)===JSON.stringify(b);

/** 存储方法同步且不执行网络操作；调用方必须在 save 成功后才发送写请求。 */
export interface RepositoryConnectionPendingStore {
  read(workspaceId:string):RepositoryConnectionPending|undefined;
  save(pending:RepositoryConnectionPending):void;
  /** 只删除逐字段一致的原请求；不允许迟到回执清除后来保存的命令。 */
  remove(pending:RepositoryConnectionPending):void;
}

/** 不缓存 localStorage：不同组件重新进入时仍读取同一原请求；坏数据保留，不空表降级覆盖。 */
export function createRepositoryConnectionPendingStore(storage:PendingStorage):RepositoryConnectionPendingStore{
  const load=()=>{
    let text:string|null;try{text=storage.getItem(REPOSITORY_CONNECTION_PENDING_KEY)}catch{throw Error('无法读取待确认连接请求，请恢复本地存储后重试；未发送新操作')}
    if(text===null)return {version:1 as const,records:[] as RepositoryConnectionPending[]};
    try{
      if(bytes(text)>REPOSITORY_CONNECTION_PENDING_BYTES)throw Error('size');
      const value=pendingIndex.parse(JSON.parse(text)),workspaces=new Set<string>(),commands=new Set<string>();
      for(const pending of value.records){
        if(workspaces.has(pending.input.workspaceId)||commands.has(pendingId(pending)))throw Error('duplicate');
        workspaces.add(pending.input.workspaceId);commands.add(pendingId(pending));
      }
      return value;
    }catch{throw Error('本地待确认连接记录无效，原数据已保留；请先核实原操作，不能创建新请求')}
  };
  const write=(records:RepositoryConnectionPending[])=>{
    if(records.length>REPOSITORY_CONNECTION_PENDING_LIMIT)throw Error('待确认连接工作区已达到 64 个，请先核实原请求；未发送新操作');
    const text=JSON.stringify({version:1,records});
    if(bytes(text)>REPOSITORY_CONNECTION_PENDING_BYTES)throw Error('待确认连接记录超过容量限制，请先核实原请求；未发送新操作');
    try{storage.setItem(REPOSITORY_CONNECTION_PENDING_KEY,text)}catch{throw Error('无法保存待确认连接记录，请恢复本地存储后重试；保留原请求')}
  };
  return {
    read(workspaceId){return load().records.find(record=>record.input.workspaceId===workspaceId)},
    save(raw){
      const pending=repositoryConnectionPendingSchema.parse(raw),state=load(),old=state.records.find(record=>record.input.workspaceId===pending.input.workspaceId);
      if(old&&!same(old,pending))throw Error('此工作区还有未确认的原连接请求，请先查询原回执');
      if(state.records.some(record=>record.input.workspaceId!==pending.input.workspaceId&&pendingId(record)===pendingId(pending)))throw Error('连接命令标识已属于其他工作区，请核实原请求');
      // 即使已有同一请求也重新保存一次，确保存储不可写时不会以“已有记录”为由发起重试。
      write(old?state.records:[...state.records,pending]);
    },
    remove(raw){
      const pending=repositoryConnectionPendingSchema.parse(raw),state=load(),old=state.records.find(record=>record.input.workspaceId===pending.input.workspaceId);
      if(!old)return;
      if(!same(old,pending))throw Error('待确认连接请求已变化，迟到回执不能清除新请求');
      write(state.records.filter(record=>record.input.workspaceId!==pending.input.workspaceId));
    },
  };
}

/** 核对定义提交的完整原计划身份；定义当前内容相同不能代替原提交回执。 */
export function checkedRepositoryConnectionCommit(raw:unknown,pending:RepositoryConnectionCommitPending):RepositoryConnectionCommit{
  const frozen=repositoryConnectionPendingSchema.parse(pending);if(frozen.action!=='commit')throw Error('登记请求类型不匹配');
  const receipt=repositoryConnectionCommitSchema.parse(raw),{input,expected}=frozen;
  if(receipt.identity.workspaceId!==input.workspaceId||receipt.identity.instanceId!==input.instanceId||receipt.planId!==input.planId||receipt.connectorId!==expected.connectorId||receipt.repositoryId!==expected.repositoryId||receipt.definitionHash!==expected.definitionHash)throw Error('登记回执与原计划不一致，请查询原计划回执');
  return receipt;
}

/** 授权/撤销必须是原命令、原目标及精确下一版；不把最新授权状态当成原命令回执。 */
export function checkedRepositoryConnectionReceipt(raw:unknown,pending:RepositoryConnectionGrantPending):RepositoryConnectionReceipt{
  const frozen=repositoryConnectionPendingSchema.parse(pending);if(frozen.action==='commit')throw Error('授权请求类型不匹配');
  const receipt=repositoryConnectionReceiptSchema.parse(raw),{input}=frozen,expected=frozen.action==='grant'?frozen.input:frozen.expected,grant=receipt.grant;
  if(receipt.workspaceId!==input.workspaceId||receipt.connectorId!==input.connectorId||receipt.commandId!==input.commandId||receipt.action!==frozen.action||grant.workspaceId!==input.workspaceId||grant.connectorId!==input.connectorId||grant.repositoryId!==expected.repositoryId||grant.definitionHash!==expected.definitionHash||grant.revision!==input.expectedGrantRevision+1||grant.enabled!==(frozen.action==='grant'))throw Error('授权回执与冻结请求或授权版本不一致，请查询原命令回执');
  return receipt;
}

/** 必须由后端明确核实原实例退役且原请求未受理；普通查询空值、当前实例或错误身份均不构成清除依据。 */
export function checkedRepositoryConnectionUnaccepted(raw:unknown,pending:RepositoryConnectionPending):boolean{
  const frozen=repositoryConnectionPendingSchema.parse(pending),result=repositoryConnectionUnacceptedSchema.parse(raw);
  if(result.identity.workspaceId!==frozen.input.workspaceId||result.identity.instanceId!==frozen.input.instanceId||result.action!==frozen.action||result.id!==pendingId(frozen))throw Error('未受理核实结果与原连接请求不一致，保留原请求');
  return result.unaccepted;
}

/**
 * 只供首次发送且从未未知的请求判断明确未受理；持久恢复或曾经丢失响应后不能借后来错误解锁。
 * grant 的网络核验发生在授权写入之前，所以额外三种预检失败可确认未写；commit/revoke 不作该推断。
 */
export function isRepositoryConnectionPreflightRejection(action:RepositoryConnectionPending['action'],cause:unknown):boolean{
  const code=typeof cause==='object'&&cause!==null&&'code' in cause&&typeof cause.code==='string'?cause.code
    :/^(?:Error: )?([A-Z][A-Z0-9_]+):/.exec(cause instanceof Error?cause.message:String(cause))?.[1];
  return !!code&&(['REPOSITORY_CONNECTION_INPUT','REPOSITORY_CONNECTION_PLAN','REPOSITORY_CONNECTION_DEFINITION','REPOSITORY_CONNECTION_STALE','REPOSITORY_CONNECTION_NOT_SHARED','REPOSITORY_CONNECTION_NOT_GRANTED','STALE_INSTANCE','NOT_RUNNING','WORKSPACE_STOPPING'].includes(code)
    ||action==='grant'&&['TIMEOUT','CANCELLED','CONNECTION'].includes(code));
}
