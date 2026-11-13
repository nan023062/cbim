/**
 * 目录归属：backend/engines/transport；模型请求代理与用量解析。
 * 作用定位：严格读取三种受支持 SSE 协议的请求用量，并暂存终态帧供可靠结算后交付。
 * 设计原因：引擎展示统计可能为缺字段补零，不能用作预算依据；缓存输入与推理输出按协议计一次，断流和冲突保持未知。
 * 中断诊断只取已知协议原因，不回显供应商任意错误正文；仍阻断终态和工具，不重试或补造可靠用量。
 */
import {requestBudgetUsageSchema,type RequestBudgetUsage,type RequestBudgetModel} from '../../../logic/budget/rules/model-request-budget';
import {fail} from '../../../core/errors';

const integer=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('请求用量缺失或不是安全非负整数');return v};
const optional=(v:unknown)=>v===undefined?0:integer(v);
function usage(input:number,output:number,cacheRead:number,cacheWrite:number,total?:unknown):RequestBudgetUsage{
  const totalTokens=input+output+cacheRead+cacheWrite;if(total!==undefined&&integer(total)!==totalTokens)throw Error('请求用量总数冲突');
  return requestBudgetUsageSchema.parse({input,output,cacheRead,cacheWrite,totalTokens});
}
function openai(value:any,responses:boolean){
  if(!value||typeof value!=='object')throw Error('请求没有完整 usage');
  const input=integer(responses?value.input_tokens:value.prompt_tokens),output=integer(responses?value.output_tokens:value.completion_tokens),details=responses?value.input_tokens_details:value.prompt_tokens_details;
  const reads=[details?.cached_tokens,...(responses?[]:[value.prompt_cache_hit_tokens,value.cached_tokens])].filter(v=>v!==undefined).map(integer);
  if(reads.some(v=>v!==reads[0]))throw Error('缓存输入报告冲突');
  const read=reads[0]??0,write=optional(details?.cache_write_tokens);
  if(read+write>input)throw Error('缓存输入超过总输入');
  // completion/output tokens 已含 reasoning；只核其边界，不再把分量加一遍。
  const reasoning=responses?value.output_tokens_details?.reasoning_tokens:value.completion_tokens_details?.reasoning_tokens;
  if(reasoning!==undefined&&integer(reasoning)>output)throw Error('推理输出超过总输出');
  return usage(input-read-write,output,read,write,value.total_tokens);
}
/** 单个响应一份解析器；限制按原始字节计，UTF-8 损坏、额外终态或终态后数据均不接受。 */
export class RequestBudgetUsageStream {
  static readonly responseBytes=64*1024*1024;
  static readonly frameBytes=8*1024*1024;
  private readonly decoder=new TextDecoder('utf-8',{fatal:true});
  private pending='';private bytes=0;private result?:RequestBudgetUsage;private terminal?:string;private started?:RequestBudgetUsage;private ended=false;private finishSeen=false;
  constructor(private readonly api:RequestBudgetModel['api']){}
  /** 返回可立即转发的非终态帧；终态只由 finish 在完整 EOF 后提供。 */
  push(bytes:Uint8Array):string[]{
    this.bytes+=bytes.byteLength;if(this.bytes>RequestBudgetUsageStream.responseBytes)throw Error('请求响应超过受管上限');
    this.pending+=this.decoder.decode(bytes,{stream:true});const out:string[]=[];
    while(true){const separator=/\r\n\r\n|\n\n|\r\r/.exec(this.pending);if(!separator)break;const end=separator.index+separator[0].length,frame=this.pending.slice(0,end);this.pending=this.pending.slice(end);if(Buffer.byteLength(frame)>RequestBudgetUsageStream.frameBytes)throw Error('请求事件超过受管上限');if(!this.accept(frame))out.push(frame)}
    if(Buffer.byteLength(this.pending)>RequestBudgetUsageStream.frameBytes)throw Error('请求事件超过受管上限');return out;
  }
  finish():{usage:RequestBudgetUsage;terminal:string}{
    this.pending+=this.decoder.decode();if(this.pending.trim()||!this.terminal||!this.result)throw Error('请求缺少完整终态或可信用量');
    return {usage:this.result,terminal:this.terminal};
  }
  private accept(frame:string):boolean{
    const lines=frame.split(/\r\n|\r|\n/),data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(!data)return false;
    if(this.ended)throw Error('请求终态后仍有数据');
    if(this.api==='openai-completions'&&data==='[DONE]'){
      if(!this.finishSeen||!this.result)throw Error('请求结束但用量或完成原因缺失');this.ended=true;this.terminal=frame;return true;
    }
    const value=JSON.parse(data);if(!value||typeof value!=='object'||value.error)throw Error('请求流包含错误或无效事件');
    if(this.api==='openai-completions'){
      if(value.choices?.some((c:any)=>c.finish_reason!==undefined&&c.finish_reason!==null))this.finishSeen=true;
      const candidates=[value.usage,...(Array.isArray(value.choices)?value.choices.map((c:any)=>c.usage):[])].filter(v=>v!==undefined&&v!==null);
      for(const candidate of candidates){if(this.result)throw Error('请求重复报告 usage');this.result=openai(candidate,false)}return false;
    }
    if(this.api==='openai-responses'){
      if(value.type==='response.incomplete'){
        const reason=value.response?.incomplete_details?.reason;
        if(reason==='max_output_tokens')fail('MODEL_OUTPUT_LIMIT','模型输出达到本轮上限（max_output_tokens），请求未完整完成。请核实已有工具回执后继续；长文件可分段生成，或调整模型输出上限。未完整生成的工具参数不会执行，已完成操作不要重复。');
        if(reason==='content_filter')fail('MODEL_CONTENT_FILTER','供应商内容过滤导致请求未完整完成（content_filter）。请调整请求后继续；先核实已有工具回执，不重复已完成操作。');
        fail('MODEL_RESPONSE_INCOMPLETE','供应商返回未完成响应（response.incomplete），未提供可识别原因。请核实已有工具回执后继续，不自动重试。');
      }
      if(['response.failed','error'].includes(value.type))fail('MODEL_RESPONSE_FAILED','供应商返回失败响应，请求未完整完成。请核实已有工具回执后再决定是否继续，不自动重试。');
      if(value.type==='response.completed'){
        if(this.result||value.response?.status!=='completed')throw Error('请求完成状态冲突');this.result=openai(value.response?.usage,true);this.ended=true;this.terminal=frame;return true;
      }return false;
    }
    const event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();if(event!==value.type)throw Error('Anthropic 事件名与正文不符');
    if(value.type==='error')throw Error('请求流包含错误');
    if(value.type==='message_start'){
      if(this.started||this.result)throw Error('请求重复开始');const u=value.message?.usage;
      this.started=usage(integer(u?.input_tokens),integer(u?.output_tokens),optional(u?.cache_read_input_tokens),optional(u?.cache_creation_input_tokens));
    }else if(value.type==='message_delta'){
      if(!this.started||this.result||!value.delta?.stop_reason)throw Error('请求缺少唯一完成原因');const u=value.usage;
      const input=u?.input_tokens===undefined?this.started.input:integer(u.input_tokens),read=u?.cache_read_input_tokens===undefined?this.started.cacheRead:integer(u.cache_read_input_tokens),write=u?.cache_creation_input_tokens===undefined?this.started.cacheWrite:integer(u.cache_creation_input_tokens),output=integer(u?.output_tokens);
      if(input<this.started.input||read<this.started.cacheRead||write<this.started.cacheWrite||output<this.started.output)throw Error('请求累计用量回退');
      this.result=usage(input,output,read,write);
    }else if(value.type==='message_stop'){
      if(!this.result)throw Error('请求缺少最终用量');this.ended=true;this.terminal=frame;return true;
    }return false;
  }
}
