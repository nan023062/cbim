/**
 * 作用定位：三种引擎共用的无进展计时器；适配器识别原生增量，工具事件复用统一协议。
 * 设计原因：长任务只因连续静默而超时，不能按整轮墙钟切断仍有输出的执行。状态刷新、重试通知
 * 不算进展；重复工具快照不续期。只持有本轮计时及快照摘要，不保存推理、正文或执行重放能力。
 */
import {createHash} from 'node:crypto';
import type {EngineEvent} from '../../logic/execution/rules/types';

/** 每轮创建一次；过期或 dispose 后迟到事件不能重新启用计时器。 */
export class RunInactivityTimer {
  private timer:ReturnType<typeof setTimeout>;
  private closed=false;
  private toolProgress=new Map<string,string>();
  /** timeoutMs 沿用旧选项，现表示连续无进展毫秒数；缺省仍为 30 分钟。 */
  constructor(timeoutMs:number|undefined,engine:string,onTimeout:(error:Error)=>void){
    const duration=timeoutMs??30*60*1000;
    this.timer=setTimeout(()=>{
      this.closed=true;this.toolProgress.clear();
      const period=duration%60000===0?`${duration/60000} 分钟`:`${duration/1000} 秒`;
      onTimeout(Error(`${engine} 连续 ${period}无执行进展，已中断；请核实未确认的操作与产物。`));
    },duration);
  }
  /** 仅由适配器确认的新输出调用；不发送模型请求，不改变工具权限。 */
  progress(){if(!this.closed)this.timer.refresh()}
  /** 工具生命周期与有内容的新进度快照续期；空快照、重复快照和普通状态事件忽略。 */
  observe(event:EngineEvent){
    if(this.closed)return;
    if(event.type==='message.delta'&&typeof event.data.text==='string'&&event.data.text.length){this.progress();return}
    if(event.type==='message'&&event.data.role==='assistant'&&(event.data.text||Array.isArray(event.data.toolCallIds)&&event.data.toolCallIds.length)){this.progress();return}
    if(!['tool.started','tool.updated','tool.finished'].includes(event.type)||typeof event.data.id!=='string')return;
    if(event.type==='tool.updated'){
      const result=event.data.result as {content?:Array<{text?:string;data?:string}>}|undefined;
      if(!result?.content?.some(part=>part.text?.length||part.data?.length))return;
    }
    const signature=event.type==='tool.updated'?createHash('sha256').update(JSON.stringify(event.data.result)).digest('hex'):event.type;
    if(this.toolProgress.get(event.data.id)===signature)return;
    this.toolProgress.set(event.data.id,signature);this.progress();
  }
  /** run 的 finally、显式停止及关闭都可调用；无副作用地重复释放。 */
  dispose(){this.closed=true;clearTimeout(this.timer);this.toolProgress.clear()}
}
