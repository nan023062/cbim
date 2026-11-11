/**
 * 作用定位：调度层知识查询编排，为内部工具与任务准备组合团队和业务工作区领域视图。
 * 设计原因：跨域组合依赖领域视图与最小快照读取端口，Core 快照契约不再反向认识查询用例；索引写入由独立知识刷新用例负责。
 */
import type {KnowledgeSnapshotReader} from '../../core/knowledge/snapshot';
import {Team} from '../../core/team/model';
import {BusinessWorkspace} from '../../core/workspace/model';

/** 每次查询各读取一个完整快照；跨查询的一致性由组合用例核版本，不缓存或修改知识。 */
export class KnowledgeQueries {
  constructor(private readonly workspace:KnowledgeSnapshotReader){}

  async modules(query=''){
    return new BusinessWorkspace(await this.workspace.snapshot()).modules(query);
  }
  async module(id:string){
    return new BusinessWorkspace(await this.workspace.snapshot()).module(id);
  }
  async agents(query=''){
    return new Team(await this.workspace.snapshot()).agents(query);
  }
  async agent(id:string){
    return new Team(await this.workspace.snapshot()).agent(id);
  }
}
