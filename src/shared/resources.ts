export const resourceKinds={
  connector:{label:'链接器',category:'connectors',description:'与外部工具打通的可定制桥梁'},
  agent:{label:'专项 Agent',category:'talent',description:'定义专业职责、能力与工作原则'},
  skill:{label:'能力 Skill',category:'talent',description:'可复用、可定制的专业方法'},
  architecture:{label:'业务架构',category:'templates',description:'可复用的多模块业务架构'},
  module:{label:'单一业务模块',category:'templates',description:'独立模块的职责、边界与知识'},
  workflow:{label:'Workflow',category:'templates',description:'围绕业务目标定制的工作流程'},
} as const;
export const resourceCategories={connectors:{label:'链接器',description:'连接外部工具与服务，为团队构建可定制的协作桥梁。'},talent:{label:'人才市场',description:'为复合多工种团队准备专项 Agent 与可复用的能力 Skill。'},templates:{label:'业务模版',description:'复用业务架构、单一业务模块与定制 Workflow。'}} as const;
export type ResourceKind=keyof typeof resourceKinds;
export type ResourceCategory=keyof typeof resourceCategories;
export interface ResourceDefinition{id:string;kind:ResourceKind;name:string;summary:string;content:string;updatedAt:string}
export interface ResourceLibrarySnapshot{repositoryId:string;revision:string;items:ResourceDefinition[]}
export type RepositoryConfig={mode:'local';location:string;repositoryId:string}|{mode:'remote';location:string;repositoryId:string};
export interface RepositoryStatus{config:RepositoryConfig|null;error?:string;sharing?:{url:string;host:string;port:number};}
