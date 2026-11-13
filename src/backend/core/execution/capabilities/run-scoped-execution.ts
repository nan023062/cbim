/**
 * 目录归属：backend/core/execution/capabilities；成员运行能力与短期门闩。
 * 原平台授权随唯一调用传递；物理收尾未知后只保留范围读取，统一异常分类使成员和应用继续持原占用。
 * 作用定位：冻结范围工具的 Runtime 一次授权、短门闩和实际退出屏障。
 * 设计原因：模型只能消费原 allowed 记录绑定的参数；事件伪造、并发工具、迟到批准与停止不能另开隔离进程。
 * 职责边界：平台读取与隔离执行注入为端口；私有输出不回写工程，清理未确认时保留运行占用。
 * 机制边界：utility 仅跟踪在途 Promise；停止接单、取消、物理退出核实与占用释放仍由本模块决定。
 */
import {InFlightOperations} from '../../../../foundations/utility';
import {isDeepStrictEqual as equal} from 'node:util';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {hash} from '../../foundation/serialization';
import {fail} from '../../foundation/errors';
import {checkedJsonToolResult} from '../../tools/results';
import {scopedReadToolName,scopedNodeToolName,scopedReadInputSchema,scopedNodeInputSchema,scopedReadOutputSchema,scopedNodeOutputSchema,type ScopedNodeInput} from '../../file-operations/scoped-execution';
import {executionScopeCovers,type ExecutionScope} from '../../workspace/execution-scope';
import {controlledFileWriteToolName,controlledFileWriteInputSchema} from '../../file-operations/controlled-file-operation';
import type {ScopedExecutionAuthorization} from '../../file-operations/isolated-execution-recovery';
/** 端口由实际成员工厂捕获路径、范围和断言；不允许模型指定宿主执行器。 */
export interface ScopedExecutionPort {
  readonly scope:ExecutionScope;
  read(path:string,signal:AbortSignal):Promise<unknown>;
  node(input:ScopedNodeInput,signal:AbortSignal,authorization:ScopedExecutionAuthorization):Promise<unknown>;
  /** 只有已发出的实际平台资源全部收束才返回；失败保留租约，不重放任何程序。 */
  drain():Promise<void>;
}
export class RunScopedExecution {
  private controller=new AbortController();private pending=new InFlightOperations();private physicalUnknown=false;
  private reserved?:{id:string;name:string;input:unknown;hash:string;allowedSeq?:number;consumed:boolean;finished:boolean;settled:boolean};
  constructor(private readonly scope:ExecutionScope,private readonly port:ScopedExecutionPort,private readonly assertReady:(id:string)=>void){this.scope=structuredClone(scope);if(!equal(scope,port.scope))fail('EXECUTION_SCOPE_PORT','平台与原冻结范围不一致')}
  guard(name:string,id:string,input:unknown,active:readonly string[]):string|undefined{
    if(this.physicalUnknown&&name!==scopedReadToolName)return '原隔离资源尚未确认收尾，仅允许只读核实；请先停止并清理原资源';
    if(this.reserved)return '范围读取或隔离执行尚未结束';
    if(name===controlledFileWriteToolName){const value=controlledFileWriteInputSchema.safeParse(input);if(!value.success||!executionScopeCovers(this.scope.write,value.data.path))return 'EXECUTION_SCOPE_DENIED: 写入超出原任务冻结范围'}
    if(![scopedReadToolName,scopedNodeToolName].includes(name as typeof scopedReadToolName))return;
    if(this.controller.signal.aborted||active.length)return '范围工具已停止或仍有其他工具/审批在途';
    const parsed=(name===scopedReadToolName?scopedReadInputSchema:scopedNodeInputSchema).safeParse(input);
    if(!parsed.success)return '范围工具参数不符合严格协议';
    const files=name===scopedReadToolName?[(parsed.data as {path:string}).path]:(parsed.data as ScopedNodeInput).files;
    if(files.some(path=>!executionScopeCovers(this.scope.read,path))||name===scopedNodeToolName&&!this.scope.node)return 'EXECUTION_SCOPE_DENIED: 文件或执行能力超出冻结范围';
    this.reserved={id,name,input:structuredClone(input),hash:hash(JSON.stringify(input)),consumed:false,finished:false,settled:false};
  }
  authorize(id:string,seq:number){if(this.reserved?.id===id&&!this.controller.signal.aborted)this.reserved.allowedSeq=seq}
  observed(type:string,id:unknown){const r=this.reserved;if(!r||r.id!==id)return;if(type==='tool.denied'&&!r.consumed)this.reserved=undefined;else if(type==='tool.finished'){r.finished=true;this.release()}}
  private release(){if(this.reserved?.finished&&this.reserved.settled)this.reserved=undefined}
  stop(){this.controller.abort(Error('运行已停止'))}
  /** 统一保留未退出分类，让上层成员与应用关闭链继续持原租约；再次关闭只收尾原资源。 */
  async drain(){await this.pending.drain();try{await this.port.drain()}catch{fail('EXECUTION_SCOPE_DRAIN_PENDING','原隔离资源尚未确认退出与清理，请保留运行占用并核实')}}
  async list(){const base={version:1,cancellation:{mode:'during_execution' as const,description:'停止同一次读取或隔离Job；实际退出前保留运行占用。'},recovery:{mode:'inspect_before_retry' as const,description:'先查原调用回执；不自动重放未知执行，私有输出不回写工程。'}};return [
    {...base,name:scopedReadToolName,effects:['read'] as const,description:'完整读取冻结读范围内一个普通UTF-8文件，最多1MiB，返回同字节指纹。替代本模式的原生read。',inputSchema:zodToJsonSchema(scopedReadInputSchema),outputSchema:zodToJsonSchema(scopedReadOutputSchema)},
    ...(this.scope.node?[{...base,name:scopedNodeToolName,effects:['command'] as const,description:'复制明确的允许文件，用固定Node在无网络LPAC/Job中执行。入口脚本通过__dirname读取快照，cwd为私有输出目录；只能返回明确输出，不能自动写回工程。预算来自冻结Workflow；退出零不代表专业验收。',inputSchema:zodToJsonSchema(scopedNodeInputSchema),outputSchema:zodToJsonSchema(scopedNodeOutputSchema)}]:[]),
  ]}
  async call(name:string,input:unknown,id?:string,signal?:AbortSignal){
    const r=this.reserved;if(!id||!r||r.id!==id||r.name!==name||r.consumed||!r.allowedSeq||!equal(input,r.input)||hash(JSON.stringify(input))!==r.hash)fail('EXECUTION_SCOPE_AUTHORIZATION','范围工具缺少原调用的一次可靠授权');
    r.consumed=true;const frozen=structuredClone(r.input);const current=signal?AbortSignal.any([signal,this.controller.signal]):this.controller.signal;let operation:Promise<unknown>|undefined;
    try{current.throwIfAborted();this.assertReady(id);operation=name===scopedReadToolName?this.port.read(scopedReadInputSchema.parse(frozen).path,current):this.port.node(scopedNodeInputSchema.parse(frozen),current,{toolCallId:id,inputHash:r.hash,allowedSeq:r.allowedSeq});this.pending.track(operation);const result=await operation;
      if(name===scopedReadToolName){const expected=scopedReadInputSchema.parse(frozen);return checkedJsonToolResult(name,result,scopedReadOutputSchema.superRefine((value,context)=>{if(value.file.path!==expected.path||Buffer.byteLength(value.content,'utf8')!==value.file.byteLength||hash(value.content)!==value.file.sha256)context.addIssue({code:'custom',message:'读取回包与原路径和真实字节不一致'})}))}
      const expected=scopedNodeInputSchema.parse(frozen);const output=checkedJsonToolResult(name,result,scopedNodeOutputSchema.superRefine((value,context)=>{if(!equal(value.inputs.map(file=>file.path),expected.files)||value.outputs.some(file=>!expected.outputs.includes(file.path)||Buffer.from(file.base64,'base64').toString('base64')!==file.base64||Buffer.from(file.base64,'base64').byteLength!==file.byteLength||hash(Buffer.from(file.base64,'base64'))!==file.sha256)||value.status==='exited'&&value.exitCode===0&&!equal(value.outputs.map(file=>file.path),expected.outputs)||value.status!=='exited'&&value.outputs.length||value.exitCode!==0&&value.outputs.length)context.addIssue({code:'custom',message:'执行回包与原输入、输出或终态不一致'})}));const facts=JSON.parse(output.content[0].text);return {...output,...(facts.status!=='exited'||facts.exitCode!==0?{isError:true}:{})};
    }finally{if(name===scopedNodeToolName)try{await this.port.drain()}catch{this.physicalUnknown=true}r.settled=true;this.release()}
  }
}
