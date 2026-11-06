/**
 * 作用定位：内部工具定义、名称查找及参数 Schema 转换。
 * 设计原因：调度与 MCP 共用协议定义；注册表不签发权限，执行上下文必须由调用边界提供。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../foundation/errors';

/** Context 只能由可信调用方传入，不能从模型的 inputSchema 中推导授权。 */
export interface ToolDefinition<Context> {
  name:string;
  description?:string;
  inputSchema:z.ZodRawShape;
  execute:(args:any,context:Context)=>Promise<any>;
}

/** 只负责协议和参数；实例、版本与副作用规则由领域入口检查。 */
export class ToolRegistry<Context> {
  private entries:ToolDefinition<Context>[]=[];
  get tools():readonly ToolDefinition<Context>[]{return this.entries}
  register(tool:ToolDefinition<Context>){
    if(!tool.name.startsWith('cbim_'))fail('TOOL_NAME','CBIM 工具必须以 cbim_ 开头');
    if(this.entries.some(t=>t.name===tool.name))fail('TOOL_DUPLICATE','工具名称重复');
    this.entries.push(tool);
  }
  list(){return this.entries.map(t=>({name:t.name,description:t.description,inputSchema:zodToJsonSchema(z.object(t.inputSchema)) as Record<string,unknown>}))}
  /** 只解析，不执行；调用方在返回后校验身份与授权再调用 execute。 */
  resolve(name:string,input:unknown){
    const tool=this.entries.find(t=>t.name===name);if(!tool)fail('TOOL','未知知识工具');
    return {tool,args:z.object(tool.inputSchema).parse(input)};
  }
}
