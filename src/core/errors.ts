/**
 * 作用定位：不依赖业务或平台的带错误码异常与抛出入口。
 * 设计原因：调用方决定错误码和文案，Core 仅保留异常身份；旧后端兼容出口与新 Logic 共用同一构造器。
 */
export class Fault extends Error {constructor(public code:string,message:string){super(message);this.name=code}}
/** 抛出包含调用方错误码的 Fault，不重试、不翻译错误，也不改变任何业务状态。 */
export function fail(code:string,message:string):never {throw new Fault(code,message)}
