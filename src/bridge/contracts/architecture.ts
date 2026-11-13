/**
 * 作用定位：团队/业务架构编辑的桌面 IPC 契约，只公开对象操作、预览差异和提交回执。
 * 设计原因：界面先预览再手动提交；不再传递真人登记或维护声明，工作区实例和知识版本继续约束提交。
 */
import type {ObjectOperation,ObjectPreview,ObjectCommit} from '../../logic/knowledge/rules/object-crud';
export {moduleBodyTemplate} from '../../logic/workspace/rules/module-outline';
export type {ObjectOperation} from '../../logic/knowledge/rules/object-crud';

/** 绑定已读取快照的对象操作；不包含真人登记，岗位与负责人使用独立契约。 */
export interface ArchitecturePreviewRequest {
  workspaceId:string;
  instanceId:string;
  revision:string;
  operations:ObjectOperation[];
}
/** 提交仅接受预览 ID，不能在确认时偷换正文、操作或版本。 */
export interface ArchitectureCommitRequest {workspaceId:string;instanceId:string;planId:string}
export type ArchitecturePreview=ObjectPreview;
export type ArchitectureCommit=ObjectCommit;
