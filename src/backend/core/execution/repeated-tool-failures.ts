/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：按本轮真实调用顺序识别同工具同参数的连续三次失败。
 * 设计原因：只保存参数规范哈希，不存正文；并发结果按提出顺序收束，重复结束事件不重复计数，熔断后不自动恢复。
 */
import {hash} from '../foundation/serialization';
import type {ToolCall} from '../tools/types';

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])]));
  return value;
}
export class RepeatedToolFailures {
  private pending:Array<{id:string;name:string;key:string;failed?:boolean}>=[];
  private previous?:string;
  private count=0;
  blocked?:{code:'TOOL_REPEAT_BLOCKED';tool:string;consecutive:3;inputHash:string};
  proposed(call:ToolCall){this.pending.push({id:call.id,name:call.name,key:hash(JSON.stringify({name:call.name,input:canonical(call.input)}))})}
  settled(id:string,failed:boolean){
    const item=this.pending.find(call=>call.id===id);
    if(!item||item.failed!==undefined||this.blocked)return;
    item.failed=failed;
    while(this.pending[0]?.failed!==undefined){
      const next=this.pending.shift()!;
      this.count=next.failed?(this.previous===next.key?this.count+1:1):0;
      this.previous=next.failed?next.key:undefined;
      if(this.count>=3){this.blocked={code:'TOOL_REPEAT_BLOCKED',tool:next.name,consecutive:3,inputHash:next.key};return this.blocked}
    }
  }
}
