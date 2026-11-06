/**
 * 作用定位：跨领域统一错误码与失败出口。
 * 设计原因：错误不依赖文件系统或应用生命周期，调用方可保留原始错误码。
 */
export class Fault extends Error {constructor(public code:string,message:string){super(message);this.name=code}}
export function fail(code:string,message:string):never {throw new Fault(code,message)}
