/**
 * 作用定位：链接器领域封装，管理插件或资源仓库的静态身份、查询与重复校验。
 * 设计原因：按提供方区分身份，避免不同仓库被当成同一空插件；定义和查询不携带任何网络授权。
 */
import {isResourceRepositoryConnector,type ConnectorDefinition} from './definition';
export type {ConnectorDefinition} from './definition';
/** 输入已通过结构 Schema；校验跨条目的身份约束，不执行任何外部工具。 */
export class ConnectorRegistry {
  constructor(private entries:ConnectorDefinition[]){}
  list(query=''){const q=query.toLowerCase();return this.entries.filter(c=>!q||`${c.id} ${c.name} ${c.summary}`.toLowerCase().includes(q))}
  get(id:string){return this.entries.find(c=>c.id===id)}
  ids(){return new Set(this.entries.map(c=>c.id.toLowerCase()))}
  duplicates(){
    const ids=new Set<string>(),providers=new Set<string>(),duplicates:string[]=[];
    for(const c of this.entries){
      const id=c.id.toLowerCase(),provider=isResourceRepositoryConnector(c)
        ?JSON.stringify(['resource_repository_v1',c.repository.repositoryId.toLowerCase()])
        :JSON.stringify(['plugin',c.plugin.ghost_id,c.plugin.namespace]);
      if(ids.has(id)||providers.has(provider))duplicates.push(c.id);ids.add(id);providers.add(provider);
    }
    return duplicates;
  }
}
