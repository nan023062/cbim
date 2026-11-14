/**
 * 目录归属：logic/budget/rules/models；模型配置与预算端口。
 * 作用定位：定义各引擎共用传输与工作区请求账本之间的可信窄端口。
 * 设计原因：引擎只负责实际 IO 和协议用量；请求身份、冻结价格和可靠事务由装配方持有，不向模型暴露修改入口。
 */
import type {RequestBudgetModel,RequestBudgetUsage,ModelRequestBudgetChange} from './model-request-budget';

export type RequestUnknownReason=Extract<ModelRequestBudgetChange,{phase:'unknown'}>['reason'];
/** 一个真实 HTTP 尝试对应一个凭据；issue 完成前不得发网，终态提交失败也不得交付模型结果。 */
export interface RequestBudgetTicket {
  readonly requestId:string;
  issue():Promise<void>;
  /** issue 返回后、实际 fetch 的同一同步段再核内存停止屏障；不进行第二次异步准入。 */
  assertSend():void;
  report(usage:RequestBudgetUsage):Promise<void>;
  unknown(reason:RequestUnknownReason):Promise<void>;
  notSent(reason:'cancelled_before_send'|'closed_before_send'):Promise<void>;
}
/** 工厂固定实际运行和模型；调用方只提供实际正文摘要及协议输出上限，不可选额度、身份或价格。 */
export interface RequestBudgetPort {
  readonly model:RequestBudgetModel;
  reserve(input:{requestHash:string;maxOutputTokens:number}):Promise<RequestBudgetTicket>;
}
