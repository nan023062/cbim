/**
 * 作用定位：团队/业务架构编辑的桌面 IPC 契约，只公开对象操作、预览差异和提交回执。
 * 设计原因：界面必须先预览再手动提交；维护确认仅传本机用户的明确选择，签署记录由后端生成，不能由 Agent 工具冒用。
 */
import type {ObjectOperation,PersonUpsert,ObjectPreview,ObjectCommit} from '../../backend/core/knowledge/object-crud';
export type {ObjectOperation,PersonUpsert} from '../../backend/core/knowledge/object-crud';

/** 本次新增/编辑模块的维护声明；省略 moduleId 时仅允许一个模块操作，后端从该操作推导身份。 */
export interface ArchitectureMaintenanceRequest {
  moduleId?:string;
  maintainerPersonIds:[string,...string[]];
  /** 本机用户在维护表单明确确认；不代表已认证身份或授予模型执行权限。 */
  confirmed:true;
}
/** 绑定已读取快照的请求；当前桌面批次最多编辑一个模块，以保证维护确认与模块一一对应。 */
export interface ArchitecturePreviewRequest {
  workspaceId:string;
  instanceId:string;
  revision:string;
  operations:ObjectOperation[];
  /** 与对象操作在同一版本、同一事务中提交，不预先写花名册。 */
  peopleUpserts?:PersonUpsert[];
  maintenance?:ArchitectureMaintenanceRequest;
}
/** 提交仅接受预览 ID，不能在确认时偷换正文、维护人或版本。 */
export interface ArchitectureCommitRequest {workspaceId:string;instanceId:string;planId:string}
export type ArchitecturePreview=ObjectPreview;
export type ArchitectureCommit=ObjectCommit;
