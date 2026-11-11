/**
 * 作用定位：工作区登记与运行视图的公开数据，供 IPC 协议和界面共同引用。
 * 设计原因：纯 DTO 不反向引用调用桥，避免操作响应与 Bridge 形成类型循环。
 */
import type {TaskView} from '../../backend/core/knowledge/types';
/** 工作区登记身份；path 为规范化实际路径，previousIds 仅关联旧身份历史，不合并数据。 */
export interface WorkspaceEntry { id:string; path:string; name:string; lastOpened?:string; previousIds?:string[] }
/** 本机登记清单；内部工作区运行时的启动集合直接取 entries。 */
export interface Catalog {version:1; entries:WorkspaceEntry[]; recent:string[];}
/** 提供界面的内部工作区运行快照；knowledgeErrors 是知识规则检查结果，与运行状态独立。 */
export interface WorkspaceView extends WorkspaceEntry {state:string; error?:string; tasks:TaskView[]; revision?:string; changed?:boolean;instanceId?:string;knowledgeErrors?:number}
