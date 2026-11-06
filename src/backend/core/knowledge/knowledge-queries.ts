/**
 * 作用定位：核心知识查询门面，装配团队与业务工作区领域视图并刷新索引。
 * 设计原因：按 KnowledgeWorkspace 契约取得快照，领域查询不依赖 main 的工作区实现。
 */
import {randomUUID} from 'node:crypto';
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
  async refresh(){
    const s=await this.workspace.snapshot();
    if(!s.validation!.structural)return {...context(s),state:'invalid',indexesUpdated:false,validation:s.validation};
    // User-managed files are already on disk. Only regenerate derived indexes;
    // the existing transaction protects against concurrent edits and interruption.
    const result=await this.workspace.commit({workspaceId:s.workspaceId,instanceId:s.instanceId,revision:s.revision,requestId:randomUUID(),changes:[]});
    const final=await this.workspace.snapshot();
    return {...context(final),state:final.validation!.structural?'refreshed':'invalid',indexesUpdated:true,changed:result.changed,validation:final.validation,notice:'只更新派生注册表，未改写用户知识正文；仍需语义 review。'};
  }
}
