/**
 * 作用定位：链接器领域封装，管理注册身份、插件映射、查询和重复校验。
 * 设计原因：核心描述链接器是什么以及如何引用；网络连接和插件进程由外部适配器负责。
 */
export interface ConnectorDefinition {
  id:string;name:string;summary:string;
  /** 外部插件身份映射；定义存在不代表插件已经连接或获准执行。 */
  plugin:{ghost_id:string;namespace:string|null};
}
/** 输入已通过结构 Schema；校验跨条目的身份约束，不执行任何外部工具。 */
export class ConnectorRegistry {
  constructor(private entries:ConnectorDefinition[]){}
  list(query=''){const q=query.toLowerCase();return this.entries.filter(c=>!q||`${c.id} ${c.name} ${c.summary}`.toLowerCase().includes(q))}
  get(id:string){return this.entries.find(c=>c.id===id)}
  ids(){return new Set(this.entries.map(c=>c.id.toLowerCase()))}
  duplicates(){
    const ids=new Set<string>(),plugins=new Set<string>(),duplicates:string[]=[];
    for(const c of this.entries){const id=c.id.toLowerCase(),plugin=JSON.stringify(c.plugin);if(ids.has(id)||plugins.has(plugin))duplicates.push(c.id);ids.add(id);plugins.add(plugin)}
    return duplicates;
  }
}
