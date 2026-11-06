/**
 * 作用定位：模块长期维护责任的知识契约，区别于 Task 的执行 Agent 与历史作者。
 * 设计原因：业务派发必须核实模块有人维护；维护关系随知识版本保存，不绑定临时成员进程。
 */
/** module.json 中的显式维护关系；身份从所属快照和模块路径补齐。 */
export interface ModuleMaintenanceDefinition {
  bindingId:string;
  maintainerPersonIds:[string,...string[]];
  revision:number;
  state:'active'|'retired';
  /** 本机用户声明的确认记录，不是认证身份或对本次任务的权限批准。 */
  confirmation:{recordId:string;source:'local_user';confirmedAt:string};
}
/** 已归属到真实工作区和模块的维护关系，不从调用参数接受这两个身份。 */
export interface ModuleMaintenanceBinding extends ModuleMaintenanceDefinition {
  workspaceId:string;
  moduleId:string;
}
