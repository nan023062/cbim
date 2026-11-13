/**
 * 作用定位：字符串处理工具，当前提供已解码文本的 LF 增量分帧。
 * 设计原因：按文本处理类别集中工具函数和数据结构；缓冲机制不承担协议解析或进程处置。
 * 职责边界：完整帧与尾部限制由调用方指定，不隐式 trim、转码或补齐 EOF 消息。
 */
/** 消费者定义文本帧限制，字符/字节计量及协议策略保持在调用方。 */
export interface LineFramePolicy {
  /** 验证完整原始帧（不含 LF）；CR、空白、大小单位及异常由消费者解释。 */
  checkLine:(line:string)=>void;
  /** 每次消费完全部完整帧后验证未终止尾部；不能把尾部当作已完成消息。 */
  checkRemainder:(text:string)=>void;
}
/** 单输入流的增量文本缓冲；按 LF 分帧并保留未终止尾部，不共享状态。 */
export class LineFramer {
  private remainder='';
  constructor(private readonly policy:LineFramePolicy){}

  /**
   * 同步依次交付完整帧；检查或接收回调抛错即停止，已交付帧不撤回，后续完整帧不提前丢弃。
   * 不 trim、不解析 JSON、不 flush EOF；不支持回调重入 push，同一实例仅供一个输入流使用。
   */
  push(chunk:string,receive:(line:string)=>void):void {
    this.remainder+=chunk;
    let offset:number;
    while((offset=this.remainder.indexOf('\n'))>=0){
      const line=this.remainder.slice(0,offset);
      this.remainder=this.remainder.slice(offset+1);
      this.policy.checkLine(line);
      receive(line);
    }
    this.policy.checkRemainder(this.remainder);
  }
}
