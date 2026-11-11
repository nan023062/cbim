import type {EngineContext} from '../src/backend/core/brain/types';
import {validateToolResult,type ToolResult} from '../src/backend/core/tools/results';

/** 测试引擎按可信能力 ID 查找端口，保持原调用身份与取消信号；不暴露业务实例或平台内部字段。 */
export function runtimeToolGroup(context:EngineContext,id:string){
  const capability=context.capabilities?.find(item=>item.id===id);
  if(!capability)return;
  return {list:()=>capability.tools.list(),call:async(name:string,input:Record<string,unknown>,toolCallId?:string,signal=new AbortController().signal)=>{
    const result=validateToolResult(name,await capability.tools.call(name,input,signal,toolCallId)) as ToolResult;
    return {...result,content:result.content.map(block=>{if(block.type!=='text')throw Error('此领域测试期望文本回执');return block})};
  }};
}
