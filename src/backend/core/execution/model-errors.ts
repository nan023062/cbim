/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：把模型结束原因转换为用户可理解的执行错误，供实时引擎和历史回放共用。
 * 设计原因：length 表示生成触及输出或上下文长度限制，并非文件权限错误；同时展示配置额度与原生请求实际额度，保留协议标识与用量，不泄露推理正文，
 * 不自动重放工具或无限续写，用户调整配置后可继续原会话。
 */
export function modelStopError(message:{stopReason?:string;errorMessage?:string;usage?:{output?:number;reasoning?:number}},maxTokens?:number,requestLimit?:number):string|undefined{
  if(message.stopReason==='length'){
    const usage=message.usage;
    const counts=typeof usage?.output==='number'?`本次输出 ${usage.output} token${typeof usage.reasoning==='number'?`（其中推理 ${usage.reasoning}）`:''}。`:'';
    const advice=maxTokens&&typeof usage?.output==='number'&&usage.output>=maxTokens?'输出用量已达到配置上限，可在“设置 → 模型供应商 → 编辑”提高最大输出（须符合供应商限制）。':'仅凭 length 不能确定是输出预算、上下文窗口还是供应商侧限制；请核对供应商响应与模型配置，不要只提高最大输出。';
    return `模型返回长度限制（length），本次回复被截断。${maxTokens?`配置的最大输出为 ${maxTokens} token。`:''}${counts}${requestLimit?`实际请求的输出额度为 ${requestLimit} token。${maxTokens&&requestLimit<maxTokens?'Pi 已按配置容量与剩余上下文降低额度；请先核对模型真实容量与压缩设置。':''}`:''}${advice}推理和正文可能共享预算。可在原对话继续，先核实已有文件，再分步实现和验证。`;
  }
  if(message.stopReason==='error')return message.errorMessage||'模型请求失败，请检查供应商连接与模型配置后重试。';
  return undefined;
}
