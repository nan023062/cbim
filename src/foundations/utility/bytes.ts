/**
 * 作用定位：字节处理工具，当前提供传入 Web ReadableStream 的有界收集。
 * 设计原因：按字节处理类别维护大小限制和 reader 生命周期；不发起网络请求或解释内容。
 * 职责边界：只拥有本次 reader，不拥有底层连接；取消不等待不合作的底层 cancel Promise 完成。
 */
/** 流超过调用者给定字节上限；业务错误码、重试及显示文案由消费者决定。 */
export class ByteLimitError extends RangeError {
  constructor(readonly maxBytes:number){super('Byte stream exceeds limit');this.name='ByteLimitError'}
}

/**
 * 消费完整流才返回；超限、取消或流错误均不交付半截正文。null 正文视为空字节。
 * maxBytes 是非负安全整数，signal 的原 reason 保留；非法上限或预先取消不取得 reader。
 * 失败请求 cancel 并释放锁/监听；底层 cancel 失败不覆盖原错误，也不代表网络/进程已经退出。
 * 分块复制后合并，保留字节视图范围；存储 O(maxBytes)，不适用于大文件落盘下载。
 */
export async function readBoundedBytes(body:ReadableStream<Uint8Array>|null,options:{maxBytes:number;signal?:AbortSignal}):Promise<Uint8Array>{
  const {maxBytes,signal}=options;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('maxBytes must be a non-negative safe integer');
  signal?.throwIfAborted();
  if(!body)return new Uint8Array();
  const reader=body.getReader(),chunks:Uint8Array[]=[];
  let total=0,cancelled=false,rejectRead:((reason:unknown)=>void)|undefined;
  const cancel=(reason:unknown)=>{
    if(cancelled)return;cancelled=true;
    // 底层取消可能一直不返回；只观察拒绝，不能让取消本身成为新的无限等待。
    try{void reader.cancel(reason).catch(()=>{})}catch{}
  };
  const abort=()=>{cancel(signal!.reason);rejectRead?.(signal!.reason)};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      signal?.throwIfAborted();
      const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
        rejectRead=reject;void reader.read().then(resolve,reject);
      });
      rejectRead=undefined;signal?.throwIfAborted();
      if(part.done)break;
      if(part.value.byteLength>maxBytes-total)throw new ByteLimitError(maxBytes);
      total+=part.value.byteLength;
      // Buffer 也是 Uint8Array，但其 slice 仍共享存储；显式构造副本防止生产者复用后篡改已读字节。
      if(part.value.byteLength)chunks.push(new Uint8Array(part.value));
    }
    const result=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength}
    return result;
  }catch(error){cancel(error);throw error}
  finally{rejectRead=undefined;signal?.removeEventListener('abort',abort);reader.releaseLock()}
}
