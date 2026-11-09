/**
 * 作用定位：核心知识查询门面，装配团队与业务工作区领域视图并刷新索引。
 * 设计原因：按 KnowledgeWorkspace 契约取得快照，领域查询不依赖 main 的工作区实现；刷新保留调用方明确的原版本和请求 ID，失败不换 ID 自动重试。
 */
import {fail} from '../foundation/errors';
import {knowledgeRefreshRequest,type KnowledgeRefreshInput} from './knowledge-write-input';
import type {KnowledgeWorkspace} from './ports';
import {context} from './snapshot';
import {Team} from '../team/model';
import {BusinessWorkspace} from '../workspace/model';
export class KnowledgeQueries {
  constructor(private workspace:KnowledgeWorkspace){}
  async modules(query=''){return new BusinessWorkspace(await this.workspace.snapshot()).modules(query)}
  async module(id:string){return new BusinessWorkspace(await this.workspace.snapshot()).module(id)}
  async agents(query=''){return new Team(await this.workspace.snapshot()).agents(query)}
  async people(query=''){return new Team(await this.workspace.snapshot()).people(query)}
  async agent(id:string){return new Team(await this.workspace.snapshot()).agent(id)}
  /** 先查询完整原请求的成功 journal；重复请求不再写，返回的校验仍是当前知识，不冒充原时刻快照。 */
  async refresh(input:KnowledgeRefreshInput){
    const request=knowledgeRefreshRequest(input);this.workspace.assert(request);
    const previous=await this.workspace.committedReceipt(request);
    const s=await this.workspace.snapshot();
    if(!previous&&s.revision!==request.revision)fail('CONFLICT','知识已变化，请重新读取；不能将原刷新请求绑定到今日版本');
    if(!previous&&!s.validation!.structural)return {...context(s),state:'invalid',indexesUpdated:false,validation:s.validation};
    // 正文已经在磁盘；原事务再次核版本并生成索引，原成功记录不重复提交。
    const result=previous??await this.workspace.commit(request);
    const final=await this.workspace.snapshot();
    return {...context(final),state:final.validation!.structural?'refreshed':'invalid',indexesUpdated:true,changed:result.changed,validation:final.validation,notice:'只更新派生注册表，未改写用户知识正文；仍需语义 review。'};
  }
}
