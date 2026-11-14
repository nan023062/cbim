/**
 * 目录归属：logic/knowledge/storage；知识物理事务与恢复。
 * 作用定位：知识物理事务与私有治理账本之间的窄端口；仅供 Main 的可信工作区装配。
 * 设计原因：保护规则、人工决定和知识写入必须共用同一串行边界，但账本不能反向调用工作区形成锁循环。
 * 职责边界：普通 ChangeRequest 没有批准字段；这里的 intentId 只能由独立桌面治理服务交给事务端口。
 */
import type {ChangeRequest,Preview,Snapshot} from '../rules/types';
import type {KnowledgeCommit} from '../rules/ports';

/** 原知识 journal 保存的精确治理来源，不携带正文或可复用的外部授权。 */
export interface KnowledgeGovernanceBinding {intentId:string;protectionId:string;proposalId:string;decisionId:string}
export interface KnowledgeJournalStatus {state:'prepared'|'committing'|'committed'|'rolled_back'|'recovery_required';before:Record<string,string|null>;after:Record<string,string|null>;governance?:KnowledgeGovernanceBinding;result?:KnowledgeCommit}
/** 实现方只访问已初始化的私有账本，不持有另一个会回调知识存储的队列。 */
export interface KnowledgeGovernanceAuthority {
  request(intentId:string):Promise<ChangeRequest>;
  hasIntent(requestId:string):boolean;
  /** 只比对私有意图和原日志；不能递归查询 journal 或改变账本。 */
  verifyJournal(request:ChangeRequest,status:KnowledgeJournalStatus):void;
  verify(current:Snapshot,preview:Preview,request:ChangeRequest,journal:(request:ChangeRequest)=>Promise<KnowledgeJournalStatus|undefined>,intentId?:string):Promise<KnowledgeGovernanceBinding|undefined>;
}
/** 回调已经处于知识串行屏障内；不得再次调用 Workspace.commit/preview 或排队的治理入口。 */
export interface KnowledgeGovernanceTransaction {
  snapshot():Promise<Snapshot>;
  preview(request:ChangeRequest):Promise<Preview>;
  journal(request:ChangeRequest):Promise<KnowledgeJournalStatus|undefined>;
  apply(intentId:string):Promise<KnowledgeCommit>;
}
