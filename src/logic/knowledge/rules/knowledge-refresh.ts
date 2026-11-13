/**
 * 作用定位：按原身份、版本与请求 ID 刷新派生知识索引，独立于只读领域查询。
 * 设计原因：刷新需要可靠事务能力，不能透过查询对象隐式写入；只接收核身份、读快照、查原回执与提交四项端口，保留重复请求及未知结果语义。
 */
import {fail} from '../../../core/errors';
import {knowledgeRefreshRequest,type KnowledgeRefreshInput} from './knowledge-write-input';
import type {ChangeRequest,KnowledgeCommit,KnowledgeSnapshotReader} from './types';
import {context} from './read-models';

/** 实现必须在提交事务内再次核版本；回执查询不重放请求，写入权限由调用入口单独核实。 */
export interface KnowledgeRefreshPort extends KnowledgeSnapshotReader {
  assert(identity:{workspaceId:string;instanceId:string}):void;
  committedReceipt(request:ChangeRequest):Promise<KnowledgeCommit|undefined>;
  commit(request:ChangeRequest):Promise<KnowledgeCommit>;
}

export class KnowledgeRefresh {
  constructor(private readonly workspace:KnowledgeRefreshPort){}
  /** 原成功回执优先；重复不再提交，返回的校验仍来自当前快照，不冒充原时刻状态。 */
  async refresh(input:KnowledgeRefreshInput){
    const request=knowledgeRefreshRequest(input);this.workspace.assert(request);
    const previous=await this.workspace.committedReceipt(request);
    const s=await this.workspace.snapshot();
    if(!previous&&s.revision!==request.revision)fail('CONFLICT','知识已变化，请重新读取；不能将原刷新请求绑定到今日版本');
    if(!previous&&!s.validation!.structural)return {...context(s),state:'invalid',indexesUpdated:false,validation:s.validation};
    const result=previous??await this.workspace.commit(request);
    const final=await this.workspace.snapshot();
    return {...context(final),state:final.validation!.structural?'refreshed':'invalid',indexesUpdated:true,changed:result.changed,validation:final.validation,notice:'只更新派生注册表，未改写用户知识正文；仍需语义 review。'};
  }
}
