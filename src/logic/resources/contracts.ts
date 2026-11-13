/**
 * 作用定位：资源种类、仓库快照、登录占位及仓库状态的共享类型。
 * 设计原因：统一三类资源的定义与仓库状态；共享类型不包含凭据或执行授权。
 */
export const resourceKinds={
  connector:{label:'链接器',category:'connectors',description:'与外部工具打通的可定制桥梁'},
  team:{label:'团队架构',category:'talent',description:'可复用的完整团队、成员与共享能力定义'},
  agent:{label:'专项 Agent',category:'talent',description:'定义专业职责、能力与工作原则'},
  skill:{label:'能力 Skill',category:'talent',description:'可复用、可定制的专业方法'},
  architecture:{label:'业务架构',category:'templates',description:'整体发布和使用的完整业务架构与流程'},
  module:{label:'单一业务模块',category:'templates',description:'独立模块的职责、边界与知识'},
  workflow:{label:'Workflow',category:'templates',description:'围绕业务目标定制的工作流程'},
} as const;
export const resourceCategories={connectors:{label:'链接器',description:'连接外部工具与服务，为团队构建可定制的协作桥梁。'},talent:{label:'人才市场',description:'复用完整团队、专项 Agent 与能力 Skill。'},templates:{label:'业务模版',description:'整体复用业务架构及其模块与 Workflow；旧单模块资源仅供浏览。'}} as const;
export type ResourceKind=keyof typeof resourceKinds;
export type ResourceCategory=keyof typeof resourceCategories;
/** 可复用资源的定义，不表示已安装或已应用到任何工作区；updatedAt 为 ISO 时间。 */
export interface ResourceDefinition{id:string;kind:ResourceKind;name:string;summary:string;content:string;updatedAt:string}
/** 完整仓库快照；提交需同时携带仓库身份和 revision，防止写入错误仓库或覆盖更新。 */
export interface ResourceLibrarySnapshot{repositoryId:string;revision:string;items:ResourceDefinition[]}
/** 公开仓库配置，不含令牌；远端配置由未来账号会话提供。 */
export type RepositoryConfig={mode:'local';location:string;repositoryId:string}|{mode:'remote';location:string;repositoryId:string};
/** 账号状态占位；只有经账号服务确认后才能进入 signedIn，当前无登录入口。 */
export type RepositorySession={state:'signedOut'}|{state:'signedIn';accountId:string};
/** 面向界面的仓库状态；config 为空表示尚无可用来源，sharing 仅在本机共享期间存在。 */
export interface RepositoryStatus{session:RepositorySession;source:'local'|'server';config:RepositoryConfig|null;error?:string;sharing?:{url:string;host:string;port:number};}
