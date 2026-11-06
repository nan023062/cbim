/**
 * 作用定位：知识快照、校验与事务的数据契约，维护任务与业务任务分开。
 * 设计原因：领域数据由 Core 拥有，避免知识规则反向依赖桌面 IPC 或展示类型。
 */
/** 知识校验/重建索引任务视图，不是内部 Loop 的业务任务持久化定义。 */
export interface TaskView {id:string; workspaceId:string; name:string; state:string; progress:string; result?:unknown; error?:string}
/** 知识正文及内容哈希；path 是服务返回的知识标识，不授权 Agent 的原生工具直接访问磁盘。 */
export interface KnowledgeFile {path:string; text:string; hash:string}
/** 单文件预期变更；text 为 null 表示删除，否则为完整新正文。 */
export interface Change {path:string; text:string|null}
/** 绑定 workspaceId、instanceId 和读取 revision；requestId 提供同一内容的幂等提交。 */
export interface ChangeRequest {workspaceId:string; instanceId:string; revision:string; requestId:string; changes:Change[]}
/** 程序确定性校验问题；warning 不阻断结构通过，error 阻断提交。 */
export interface Issue {severity:'error'|'warning'; code:string; message:string; path?:string}
/** 校验及派生索引；structural 只表示结构合格，架构仍需 review、业务验证未执行。 */
export interface Validation {issues:Issue[]; indexes:Record<string,string>; tree:{nodes:Record<string,ModuleNode>;roots:string[]}; skills?:Record<string,{chain:string[];entries:{name:string;purpose:string;reference:string;owner:string;scope:string}[]}>; structural:boolean; architecture:'review-required'; business:'not-run'}
/** 正式模块包含树节点；children 为模块 ID，sources 描述目录归属而非运行时依赖。 */
export interface ModuleNode {id:string;name:string;summary:string;sources:{location:string;scope:string}[];children:string[];virtual?:boolean}
/** 同一知识版本的正文快照；revision 由所有文件内容共同决定。 */
export interface Snapshot {workspaceId:string;instanceId:string;revision:string;files:KnowledgeFile[];validation?:Validation}
/** 尚未提交的计划与差异；确认提交仍会重新检查版本与规则。 */
export interface Preview {request:ChangeRequest;changes:Change[];validation:Validation;affected:string[];diff:string;fingerprint:string}
