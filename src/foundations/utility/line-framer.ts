/**
 * 作用定位：把已解码文本按 LF 拆帧，保留未终止尾部并按调用方规则限制单帧。
 * 设计原因：只统一缓冲/拆行，不统一协议解析、字符与字节计量或失败后的进程处置。
 */
export interface LineFramePolicy {
  /** 验证完整原始帧（不含 LF）；CR、空白、大小单位及异常由消费者解释。 */
  checkLine:(line:string)=>void;
  /** 每次消费完全部完整帧后验证未终止尾部；不能把尾部当作已完成消息。 */
  checkRemainder:(text:string)=>void;
}
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
