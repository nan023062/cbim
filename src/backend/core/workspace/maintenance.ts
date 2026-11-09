/**
 * 作用定位：旧版模块真人维护声明的兼容类型，保留历史解码所需字段。
 * 设计原因：真人花名册机制已废弃；历史字段不生成、不回填，也不能作为当前岗位、权限或派发资格。
 */
/** @deprecated 旧 module.json 的历史数据形状；新对象和派发不再建立此关系。 */
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
