/**
 * 作用定位：主运行的统一状态与原回执读取入口，保留各领域实际校验和恢复语义。
 * 设计原因：只组合已装配的只读能力；目标/图来自原服务的同次读取，负责人和知识另查，不伪称跨存储原子快照。
 */
import {fail} from '../../core/foundation/errors';
import {coordinationVersions} from '../../core/tasks/coordination-preview';
import {mainToolOutputSchemas} from '../../core/tasks/main-tool-output';
import {jsonToolResult,validateToolResult,type ToolResult} from '../../core/tools/results';
import type {EngineToolSchema} from '../../core/execution/engine-tools';
import type {RunToolDescriptor} from '../../core/tools/policy/tool-policy';

interface ReadPort {
  list():EngineToolSchema[];
  describe(name:string,input:unknown):RunToolDescriptor;
  call(name:string,input:Record<string,unknown>,signal:AbortSignal,toolCallId?:string):Promise<unknown>;
}
const inspectRoutes={state:'cbim_goal_inspect',task:'cbim_dispatch_inspect',owner:'cbim_module_owner_inspect',member:'cbim_member_inspect',governance:'cbim_governance_get'};
const receiptRoutes={dispatch:'cbim_dispatch_command_report',owner:'cbim_module_owner_receipt',member:'cbim_member_receipt',governance:'cbim_governance_receipt'};

/** 旧族保留兼容，目录明确规范入口；不改变历史调用名、指纹或事务。 */
export function coordinationCompatibility(tool:EngineToolSchema):EngineToolSchema {
  const inspect=Object.entries(inspectRoutes).find(([,name])=>name===tool.name);
  const receipt=Object.entries(receiptRoutes).find(([,name])=>name===tool.name);
  const route=inspect??receipt;
  return route?{...tool,description:`兼容入口；新调用优先 ${inspect?'cbim_state_inspect':'cbim_receipt_inspect'} target=${route[0]}，input 使用本参数。`+(tool.description??'')}:tool;
}

export class CoordinationTools {
  private readonly routes=new Map<string,{port:ReadPort;tool:EngineToolSchema}>();
  constructor(ports:ReadPort[]){
    const allowed=new Set([...Object.values(inspectRoutes),...Object.values(receiptRoutes)]);
    for(const port of ports)for(const tool of port.list())if(allowed.has(tool.name))this.routes.set(tool.name,{port,tool});
  }
  has(name:string){return name==='cbim_state_inspect'||name==='cbim_receipt_inspect'}
  list(){return (['cbim_state_inspect','cbim_receipt_inspect'] as const).flatMap(name=>{
    const definitions=name==='cbim_state_inspect'?inspectRoutes:receiptRoutes;
    const variants=Object.entries(definitions).flatMap(([target,original])=>{
      const route=this.routes.get(original);
      return route?[{type:'object',properties:{target:{const:target},input:route.tool.inputSchema},required:['target','input'],additionalProperties:false}]:[];
    });
    return variants.length?[{name,effects:['read'] as const,description:name==='cbim_state_inspect'
      ?'统一只读入口。target=state,input={} 一次返回当前目标/计划/图游标、所有任务版本与可引用候选；task 读指定任务；owner 查模块负责人和修复信息；member 查岗位差异；governance 查治理记录。各目标分别读取，只有 state 内版本来自同一存储快照。'
      :'统一原回执核实入口。target=dispatch 使用原 runId/toolCallId；owner/member 使用 commandId；governance 使用原命令身份。只查询，不重复写入；unknown/absent 不证明未执行、不允许盲重试。原生文件和命令没有这些领域账本，须检查实际运行记录和副作用。',inputSchema:{oneOf:variants}}]:[];
  })}
  private resolve(name:string,raw:unknown){
    if(!this.has(name)||!raw||typeof raw!=='object'||Array.isArray(raw))fail('COORDINATION_INPUT','只读查询参数无效');
    const value=raw as Record<string,unknown>;
    if(Object.keys(value).some(key=>!['target','input'].includes(key))||typeof value.target!=='string'||!value.input||typeof value.input!=='object'||Array.isArray(value.input))fail('COORDINATION_INPUT','只接受 target 与对应 input');
    const definitions:Record<string,string>=name==='cbim_state_inspect'?inspectRoutes:receiptRoutes;
    const original=Object.hasOwn(definitions,value.target)?definitions[value.target]:undefined;
    const route=original?this.routes.get(original):undefined;
    if(!original||!route)fail('TOOL_NOT_FOUND','本轮未装配该只读目标');
    const descriptor=route.port.describe(original,value.input);
    if(descriptor.native||descriptor.effects.some(effect=>effect!=='read'))fail('COORDINATION_READ_ONLY','统一入口只能调用真实只读能力');
    return {original,route,input:value.input as Record<string,unknown>};
  }
  describe(name:string,input:unknown):RunToolDescriptor {this.resolve(name,input);return {effects:['read'],native:false}}
  async call(name:string,input:Record<string,unknown>,signal:AbortSignal,id?:string){
    signal.throwIfAborted();const route=this.resolve(name,input);
    const result=validateToolResult(route.original,await route.route.port.call(route.original,route.input,signal,id)) as ToolResult;
    signal.throwIfAborted();
    if(route.original!=='cbim_goal_inspect')return result;
    if(result.content.length!==1||result.content[0].type!=='text')fail('TOOL_OUTPUT_INVALID','状态读取缺少完整 JSON');
    const value=mainToolOutputSchemas.cbim_goal_inspect.parse(JSON.parse(result.content[0].text));
    return jsonToolResult(name,{...value,versions:coordinationVersions(value.scope,value.graph)});
  }
}
