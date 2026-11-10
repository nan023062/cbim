/**
 * 作用定位：知识领域的派生索引刷新用例，按原请求查询提交回执并核对版本。
 * 设计原因：刷新属于知识写入，不与团队/模块查询编排共用门面；仅取得刷新端口，保留同一事务的幂等和失败语义。
 */
import {fail} from '../foundation/errors';
import {knowledgeRefreshRequest,type KnowledgeRefreshInput} from './knowledge-write-input';
import type {KnowledgeRefreshWorkspace} from './ports';
import {context} from './snapshot';

/**
 * 先核实例及原成功 journal。未提交且版本过期时拒绝；结构无效时不写。
 * 已成功请求不重复提交，但返回当前知识校验；不改正文、不换 ID 自动重试。
 */
export async function refreshKnowledgeIndexes(workspace:KnowledgeRefreshWorkspace,input:KnowledgeRefreshInput){
  const request=knowledgeRefreshRequest(input);
  workspace.assert(request);
  const previous=await workspace.committedReceipt(request);
  const snapshot=await workspace.snapshot();
  if(!previous&&snapshot.revision!==request.revision){
    fail('CONFLICT','知识已变化，请重新读取；不能将原刷新请求绑定到今日版本');
  }
  if(!previous&&!snapshot.validation!.structural){
    return {...context(snapshot),state:'invalid',indexesUpdated:false,validation:snapshot.validation};
  }
  // 正文已经在磁盘；同一事务再次核版本并生成索引，原成功记录不重复提交。
  const result=previous??await workspace.commit(request);
  const final=await workspace.snapshot();
  return {
    ...context(final),state:final.validation!.structural?'refreshed':'invalid',
    indexesUpdated:true,changed:result.changed,validation:final.validation,
    notice:'只更新派生注册表，未改写用户知识正文；仍需语义 review。',
  };
}
