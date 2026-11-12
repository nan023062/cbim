/**
 * 作用定位：工作区身份与受控路径解析端口。
 * 设计原因：Core 与调度只使用结构化契约，实际用户目录和链接检查由应用层 Paths 实现。
 */
export interface StoragePaths {
 readonly userRoot:string; readonly installRoot:string;
 /** 安装目录之外仍须保护的程序缓存根；可选以兼容无桌面更新的 CLI 与测试宿主。 */
 readonly protectedRoots?:readonly string[];
 identity(input:string):Promise<{id:string;path:string}>;
 project(id:string):string;
 local(id:string,kind:'memory'|'task-records'|'logs'|'cache'|'transactions'):string;
 knowledge(root:string,relative:string):Promise<string>;
}
