/**
 * 作用定位：实际内部工具的输入/业务输出协议、版本、副作用及取消/恢复说明，支持摘要与按需完整描述。
 * 设计原因：领域只执行一次，再核唯一 JSON 快照；发现协议不执行工具，Schema 成功和恢复说明都不授予权限或证明事务回滚。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../foundation/errors';
import type {ToolEffect} from './types';
import {checkedJsonToolResult} from './results';
import {toolMetadataSchema,type ToolCancellation,type ToolRecovery} from './contracts';

/** Context 只能由可信调用方传入，不能从模型的 inputSchema 中推导授权。 */
export interface ToolDefinition<Context> {
  name:string;
  description?:string;
  inputSchema:z.ZodRawShape;
  outputSchema:z.ZodTypeAny;
  /** 必须明确实际版本、能力和限制；注册表本身不据此签发权限。 */
  version:number;
  effects:readonly ToolEffect[];
  cancellation:ToolCancellation;
  recovery:ToolRecovery;
  /** 返回领域值，不先包装 ToolResult；执行后的协议失败不能触发第二次 execute。 */
  execute:(args:any,context:Context)=>Promise<unknown>|unknown;
}

/** 只负责协议和参数；实例、版本与副作用规则由领域入口检查。 */
export class ToolRegistry<Context> {
  private entries:ToolDefinition<Context>[]=[];
  get tools():readonly ToolDefinition<Context>[]{return this.entries}
  register(tool:ToolDefinition<Context>){
    if(!/^cbim_[A-Za-z0-9_]+$/.test(tool.name))fail('TOOL_NAME','CBIM 工具名称必须以 cbim_ 开头，后接字母、数字或下划线');
    if(this.entries.some(t=>t.name===tool.name))fail('TOOL_DUPLICATE','工具名称重复');
    if(!tool.outputSchema||typeof tool.outputSchema.safeParse!=='function')fail('TOOL_CONTRACT','工具必须声明真实业务输出 Schema');
    const metadata=toolMetadataSchema.safeParse({version:tool.version,effects:tool.effects,cancellation:tool.cancellation,recovery:tool.recovery});
    if(!metadata.success)fail('TOOL_CONTRACT','工具必须声明完整的版本、副作用与取消/恢复语义');
    this.entries.push({...tool,...metadata.data});
  }
  /** 引擎注册保持紧凑输入清单，不把全部输出 Schema 注入每次模型上下文。 */
  list(){return this.entries.map(t=>({...this.summary(t),inputSchema:zodToJsonSchema(z.object(t.inputSchema)) as Record<string,unknown>}))}
  private summary(tool:ToolDefinition<Context>){return {name:tool.name,...(tool.description===undefined?{}:{description:tool.description}),version:tool.version,effects:[...tool.effects]}}
  /** 只列实际注册条目的摘要，不承诺原生、调度或外部工具可用。 */
  catalog(){return {family:'knowledge' as const,tools:this.entries.map(tool=>this.summary(tool))}}
  /** 按需导出有限 JSON Schema 和说明；不执行领域调用，不把函数、凭据或其它工具清单嵌入结果。 */
  describe(name:string){const tool=this.entry(name);return {family:'knowledge' as const,tool:{...this.summary(tool),inputSchema:zodToJsonSchema(z.object(tool.inputSchema)),outputSchema:zodToJsonSchema(tool.outputSchema),cancellation:structuredClone(tool.cancellation),recovery:structuredClone(tool.recovery)}}}
  private entry(name:string){const tool=this.entries.find(t=>t.name===name);if(!tool)fail('TOOL','未知知识工具');return tool}
  /** 只解析，不执行；调用方在返回后校验身份与授权再调用 execute。 */
  resolve(name:string,input:unknown){
    const tool=this.entry(name);
    return {tool,args:z.object(tool.inputSchema).parse(input)};
  }
  /** 已由调用边界核对身份与授权后使用；只执行一次，不因业务输出损坏重放或补造字段。 */
  async invokeResolved(tool:ToolDefinition<Context>,args:unknown,context:Context){
    if(this.entry(tool.name)!==tool)fail('TOOL_CONTRACT','只能执行本注册表解析的实际工具');
    const value=await tool.execute(args,context);return checkedJsonToolResult(tool.name,value,tool.outputSchema);
  }
}
