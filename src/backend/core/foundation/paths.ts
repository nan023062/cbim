/**
 * 作用定位：工作区身份与受控路径解析端口。
 * 设计原因：Core 与调度只使用结构化契约，实际用户目录和链接检查由应用层 Paths 实现。
 */
export interface StoragePaths {
 readonly userRoot:string; readonly installRoot:string;
 identity(input:string):Promise<{id:string;path:string}>;
 project(id:string):string;
 local(id:string,kind:'memory'|'task-records'|'logs'|'cache'|'transactions'):string;
 discovery(id:string):string;
 knowledge(root:string,relative:string):Promise<string>;
}
