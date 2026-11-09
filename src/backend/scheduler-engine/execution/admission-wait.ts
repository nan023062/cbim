/**
 * 作用定位：定义已受理协作批次交给运行入口的进程内等待通知，不进入模型或公开 IPC 参数。
 * 设计原因：容量不足只通知原协调器重新核实；票据随批次停止撤销。单轮附件图片另经可信内存上下文传递，不能混入持久配置后随成员结果再次发送。
 */
import type {InputImage} from '../../core/brain/types';

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
  /** 安全等待首次准备的图片；存在（包括空数组）即禁止工厂再次按附件 ID 读取，仅供本轮使用。 */
  preparedInputImages?:readonly InputImage[];
}
