/**
 * 作用定位：运行记录路径中任务和执行标识的格式检查。
 * 设计原因：共享标识约束与具体磁盘日志实现解耦，拒绝路径分隔符和越界片段。
 */
export const safeId=(id:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效任务或运行标识');return id};
