/**
 * 作用定位：定义已受理协作批次交给运行入口的进程内等待通知，不进入模型或公开 IPC 参数。
 * 设计原因：容量不足只通知原协调器重新核实；票据必须随批次停止或退出撤销，不能靠释放事件重放未知执行。
 */

/** 仅 AutoCollaboration 创建；scope 与回调固定归属一个仍活动的批次。 */
export interface ExecutionAdmissionWait {
  scopeId:string;
  isCurrent():boolean;
  onReady():void;
  /** 按稳定请求键覆盖清理函数，重试不会不断积累相同票据的清理闭包。 */
  registerWithdraw(requestId:string,withdraw:()=>void):void;
}

/** 启动工厂的可信上下文；与可序列化用户 Options 分开，signal 只保护当前启动准备。 */
export interface ExecutionLaunchContext {
  requestId:string;
  scopeId?:string;
  wait?:ExecutionAdmissionWait;
  signal:AbortSignal;
}
