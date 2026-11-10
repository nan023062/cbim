/**
 * 作用定位：Claude 原生工具和内部 SDK 工具适配为 CBIM 授权与回执协议。
 * 设计原因：PreToolUse 先等模型请求结算再持久化授权；内部调用用一次性原调用 ID 绑定精确参数，禁止依名称放行。
 * 职责边界：SDK MCP 仅为当前进程内传输，不监听端口或提供对外 MCP 服务。未注册工具一律拒绝。
 */
import {isDeepStrictEqual} from 'node:util';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import type {HookCallback,McpSdkServerConfigWithInstance} from '@anthropic-ai/claude-agent-sdk';
import type {EngineContext} from '../types';
import type {EngineToolsPort} from '../engine-tools';
import {validateToolResult,type ToolResult} from '../../tools/results';

const nativeNames:Record<string,string>={Read:'read',Write:'write',Edit:'edit',Bash:'bash',Glob:'find',Grep:'grep'};
const prefix='mcp__cbim__',identityField='__cbim_call_id';
/** Anthropic 不收顶层联合：目录投影字段并只保留共同必填项，实际调用仍由 CBIM 原联合 schema 严格校验。 */
export function claudeInputSchema(schema:Record<string,unknown>){
  const variants=Array.isArray(schema.anyOf)?schema.anyOf:Array.isArray(schema.oneOf)?schema.oneOf:[];
  const {anyOf:_anyOf,oneOf:_oneOf,...object}=schema;
  const properties:Record<string,unknown>={};
  for(const variant of variants)for(const [key,value] of Object.entries(variant.properties??{}))properties[key]=properties[key]===undefined?value:{anyOf:[properties[key],value]};
  const required=variants.length?(variants[0].required??[]).filter((key:string)=>variants.every(variant=>variant.required?.includes(key))):schema.required;
  return {...object,type:'object' as const,properties:{...properties,...schema.properties as Record<string,unknown>},...(required?{required}:{})};
}
/** 原生参数只投影到公共权限/证据字段，执行仍使用原生参数，不改写业务路径。 */
export function claudeToolCall(name:string,input:Record<string,unknown>){
  const canonical=nativeNames[name];if(!canonical)return {name:name.startsWith(prefix)?name.slice(prefix.length):name,input};
  const value={...input};if(typeof value.file_path==='string'){value.path=value.file_path;delete value.file_path}
  if(name==='Edit'){value.oldText=value.old_string;value.newText=value.new_string;delete value.old_string;delete value.new_string}
  return {name:canonical,input:value};
}
/** 一个实例只服务一个 run；stop 取消未完成端口，已执行但未落盘的结果保持未知。 */
export async function claudeTools(context:EngineContext,port:EngineToolsPort,allowExecution:boolean,blocked:()=>string|undefined,settle:()=>Promise<void>=async()=>{}){
  const catalog=await port.list(),names=new Set(catalog.map(t=>t.name)),controller=new AbortController();
  const native=context.scopedExecutionTools?[]:allowExecution?Object.keys(nativeNames):['Read','Glob','Grep'];
  const active=new Map<string,{name:string;input:Record<string,unknown>;original:Record<string,unknown>;internal:boolean}>();
  const grants=new Set<string>();
  const server=new McpServer({name:'cbim',version:'1.0.0'},{capabilities:{tools:{}}});
  // MCP 目录只发布调用所需字段；CBIM 联合 outputSchema/恢复元数据由原端口校验，不能冒充 MCP 的 object 输出结构。
  server.server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalog.map(tool=>({name:tool.name,description:tool.description,inputSchema:claudeInputSchema(tool.inputSchema)}))}));
  server.server.setRequestHandler(CallToolRequestSchema,async request=>{
    const args={...request.params.arguments},id=args[identityField];delete args[identityField];
    if(typeof id!=='string')throw Error('内部工具缺少原调用身份');
    const call=active.get(id);
    if(!call||!call.internal||call.name!==request.params.name||!grants.delete(id)||!isDeepStrictEqual(call.original,args))throw Error('内部工具没有对应的一次性授权');
    controller.signal.throwIfAborted();const reason=blocked();if(reason)throw Error(reason);
    const result=validateToolResult(call.name,await port.call(call.name,args,controller.signal,id)) as ToolResult;
    // 返回结果前先保存；保存失败不补写一份成功，也不重放端口。
    await context.emit({type:'tool.finished',data:{id,name:call.name,isError:result.isError===true,result}});active.delete(id);
    return {content:result.content,isError:result.isError};
  });
  const before:HookCallback=async input=>{
    if(input.hook_event_name!=='PreToolUse')return {};
    const raw=input.tool_input;
    const deny=(reason:string)=>({hookSpecificOutput:{hookEventName:'PreToolUse' as const,permissionDecision:'deny' as const,permissionDecisionReason:reason}});
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.hasOwn(raw,identityField))return deny('工具参数无效');
    const original=raw as Record<string,unknown>,mapped=claudeToolCall(input.tool_name,original),internal=input.tool_name.startsWith(prefix)&&names.has(mapped.name);
    if(!internal&&!native.includes(input.tool_name))return deny('本轮未提供该工具');
    if(controller.signal.aborted||blocked())return deny(blocked()??'运行已停止');
    // Claude 可在完整工具块到达时提前启动调用；终态帧未交付并不能证明它尚未执行。
    await settle();
    if(controller.signal.aborted||blocked())return deny(blocked()??'运行已停止');
    const id=input.tool_use_id;
    const decision=await context.beforeTool({id,...mapped});
    if(!decision.allow||controller.signal.aborted)return deny(decision.reason??'运行已停止');
    active.set(id,{...mapped,original:structuredClone(original),internal});if(internal)grants.add(id);
    await context.emit({type:'tool.started',data:{id,name:mapped.name}});
    return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',...(internal?{updatedInput:{...original,[identityField]:id}}:{})}};
  };
  const after:HookCallback=async input=>{
    if(input.hook_event_name!=='PostToolUse'&&input.hook_event_name!=='PostToolUseFailure')return {};
    const call=active.get(input.tool_use_id);if(!call)return {};
    const failed=input.hook_event_name==='PostToolUseFailure';
    // 内部端口成功自行记录；异常保留真实失败，不能重建成功结果。
    const result=failed?{content:[{type:'text',text:input.error}]}:input.tool_response;
    await context.emit({type:'tool.finished',data:{id:input.tool_use_id,name:call.name,isError:failed,result}});
    active.delete(input.tool_use_id);grants.delete(input.tool_use_id);return {};
  };
  return {native,expected:[...native,...catalog.map(tool=>prefix+tool.name)],config:{type:'sdk',name:'cbim',instance:server} as McpSdkServerConfigWithInstance,
    hooks:{PreToolUse:[{hooks:[before],onFailure:'block' as const}],PostToolUse:[{hooks:[after],onFailure:'block' as const}],PostToolUseFailure:[{hooks:[after],onFailure:'block' as const}]},
    stop(){controller.abort()},async close(){controller.abort();grants.clear();await server.close()},
  };
}
