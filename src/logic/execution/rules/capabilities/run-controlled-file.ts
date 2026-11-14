/**
 * 目录归属：logic/execution/rules/execution/capabilities；成员运行能力与短期门闩。
 * 范围模式的cbim_scoped_read可在原写待核实时只读观察；隔离命令仍被未知写屏障阻断。
 * 作用定位：正式成员受控文件工具的单次授权与短门闩，平台写入只经过此可信运行端口。
 * 设计原因：授权来自 Runtime 自身可靠 allowed 追加返回值，不信任引擎 emit；调用失败后整轮只保留读取与求助，只有可信未写证明才能解除屏障。停止须排空实际文件进程。
 * 机制边界：utility 仅跟踪在途 Promise；停止接单、取消、物理退出核实与占用释放仍由本模块决定。
 */
import {InFlightOperations} from '../../../../core/utility';
import {isDeepStrictEqual as equal} from 'node:util';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {hash} from '../../../../core/platform/node/serialization';
import {fail} from '../../../../core/errors';
import {checkedJsonToolResult} from '../../../tools/rules/results';
import {controlledFileWriteToolName,controlledFileWriteInputSchema,controlledFileWriteOutputSchema,type ControlledFileBinding,type ControlledFileWriteInput,type ControlledFileWriteApplied} from '../../../file-operations/rules/controlled-file-operation';
import {controlledFileOperationId} from '../../../file-operations/rules/controlled-file-rules';
/** 平台只接收已消费的一次许可；原 inputHash 绑定 canonical 原参数字节，不能用 parsed 参数重算代替。 */
export interface ControlledFileRunPort {
  readonly scopeId:string;
  write(input:ControlledFileWriteInput,authorization:{toolCallId:string;inputHash:string;allowedSeq:number},signal:AbortSignal,assertCurrent:()=>void):Promise<ControlledFileWriteApplied>;
  /** 只核实原账本和进程退出；查无、unknown、applied 或读取失败均不能证明未写，绝不重试原操作。 */
  confirmNotApplied?(authorization:{toolCallId:string;inputHash:string;allowedSeq:number}):Promise<boolean>;
  drain():Promise<void>;
}
export class RunControlledFile {
  private reserved?:{id:string;input:ControlledFileWriteInput;inputHash:string;allowedSeq?:number;consumed:boolean;settled:boolean;finished:boolean;validated:boolean;failedEvent:boolean;safeNoWrite:boolean};
  /** 独立于在途调用；工具已返回失败也不能解除本轮写入、交付和检查点屏障。 */
  private unverified=new Set<string>();
  private controller=new AbortController();private pending=new InFlightOperations();
  private readonly scopeId:string;
  constructor(private readonly binding:ControlledFileBinding,private readonly port:ControlledFileRunPort,private readonly assertReady:(id:string)=>void){this.binding=structuredClone(binding);this.scopeId=port.scopeId}
  /** 在审批 await 之前预占；执行与工具终态都完成后才释放，伪早到 finished 不能解除实际 IO 占位。 */
  guard(name:string,id:string,input:unknown,active:readonly string[]):string|undefined{
    if(this.reserved)return '受控文件操作尚未结束，请先等待原操作核实';
    if(this.unverified.size&&!['read','grep','find','ls','cbim_scoped_read','cbim_task_inspect','cbim_task_help'].includes(name))return 'CONTROLLED_FILE_REVIEW_REQUIRED: 原受控写结果待核实，本轮仅可读取、查看计划或记录求助，不能再次写入、交付或停泊';
    if(name!==controlledFileWriteToolName)return;
    if(this.controller.signal.aborted)return '运行已停止，不能开始受控写入';
    const parsed=controlledFileWriteInputSchema.safeParse(input);if(!parsed.success)return '受控文件参数不符合严格单文件协议';
    if(active.length)return '仍有工具或审批在途，不能开始受控写入';
    this.reserved={id,input:structuredClone(parsed.data),inputHash:hash(JSON.stringify(input)),consumed:false,settled:false,finished:false,validated:false,failedEvent:false,safeNoWrite:false};
  }
  /** 只能由 Runtime 自身 beforeTool 的可靠 append 返回值调用；观察事件没有签发权。 */
  authorize(id:string,seq:number){if(this.reserved?.id===id&&!this.controller.signal.aborted)this.reserved.allowedSeq=seq}
  observed(type:string,id:unknown,isError=false){const current=this.reserved;if(!current||current.id!==id)return;if(type==='tool.denied'){if(!current.consumed)this.reserved=undefined;return}if(type==='tool.finished'){current.finished=true;current.failedEvent ||= isError;if(current.allowedSeq&&!current.safeNoWrite)this.unverified.add(current.id);this.release()}}
  private release(){const current=this.reserved;if(!current?.finished||!current.settled)return;if(current.safeNoWrite||current.validated&&!current.failedEvent)this.unverified.delete(current.id);else this.unverified.add(current.id);this.reserved=undefined}
  get unverifiedCallIds(){return [...this.unverified]}
  /** 供交付端口和运行结算复核，不将原 failed 回执改写为 unknown 或成功。 */
  assertVerified(){if(this.unverified.size)fail('CONTROLLED_FILE_REVIEW_REQUIRED','原受控写结果待核实，本轮不能提交交付或安全交接')}
  stop(){this.controller.abort(Error('运行已停止'))}
  /** 端口任何排空错误都表示物理退出未确认；统一稳定代码，外层不能按普通工具失败释放租约。 */
  async drain(){await this.pending.drain();try{await this.port.drain()}catch{fail('CONTROLLED_FILE_DRAIN_PENDING','文件进程尚未确认退出，请保留工作区并核实原操作')}}
  async list(){return [{name:controlledFileWriteToolName,version:1,effects:['business-write'] as const,description:'仅替换一个已存在的 UTF-8 普通文件，expectedBefore 必须来自实际读取。先可靠保存 before，再由独占句柄写入；只有 applied 是可靠成功，未知不得重试。此工具不自动回滚，也不替代实际 read、产物基线与验收。',inputSchema:zodToJsonSchema(controlledFileWriteInputSchema),outputSchema:zodToJsonSchema(controlledFileWriteOutputSchema),cancellation:{mode:'preflight_only' as const,description:'停止阻止尚未开始的写入；发出内容写后可能部分写入，只有原记录可确认结果。'},recovery:{mode:'inspect_before_retry' as const,description:'桌面查询原任务/运行/调用的受控记录；原调用不重放，补偿须另行显式提交。'}}]}
  async call(name:string,raw:unknown,id?:string,signal?:AbortSignal){
    if(name!==controlledFileWriteToolName||!id)fail('CONTROLLED_FILE_CALL','受控写入缺少真实调用身份');
    const input=controlledFileWriteInputSchema.parse(raw),reservation=this.reserved;
    if(!reservation||reservation.id!==id||reservation.consumed||!reservation.allowedSeq||!equal(input,reservation.input)||hash(JSON.stringify(raw))!==reservation.inputHash)fail('CONTROLLED_FILE_AUTHORIZATION','受控写入没有本轮一次性可靠授权');
    reservation.consumed=true;const expected=structuredClone(input),bound=structuredClone(this.binding),activeSignal=signal?AbortSignal.any([signal,this.controller.signal]):this.controller.signal;
    const check=()=>{activeSignal.throwIfAborted();this.assertReady(id)};let operation:Promise<ControlledFileWriteApplied>|undefined,dispatched=false;
    const authorization={toolCallId:id,inputHash:reservation.inputHash,allowedSeq:reservation.allowedSeq};
    this.unverified.add(id);
    try{check();dispatched=true;operation=this.port.write(input,authorization,activeSignal,check);this.pending.track(operation);const result=await operation;const output=checkedJsonToolResult(name,{state:'applied',operation:result},controlledFileWriteOutputSchema.superRefine((value,ctx)=>{const v=value.operation;if(!equal(v.binding,bound)||v.operationId!==controlledFileOperationId(bound,id)||v.scopeId!==this.scopeId||v.toolCallId!==id||v.inputHash!==reservation.inputHash||v.relativePath!==expected.path||!equal(v.before,expected.expectedBefore)||v.after.byteLength!==Buffer.byteLength(expected.content,'utf8')||v.after.sha256!==hash(expected.content))ctx.addIssue({code:'custom',message:'受控写回包与原授权或请求不一致'})}));reservation.validated=true;return output}
    catch(error){
      // 错误码或当前相同字节都不是未写证明。可信端口必须核原 not_applied 及真实退出，失败保持屏障和原错误。
      if(!dispatched)reservation.safeNoWrite=true;
      else try{reservation.safeNoWrite=await this.port.confirmNotApplied?.(authorization)===true}catch{/* 未确认不能解除屏障 */}
      if(reservation.safeNoWrite)this.unverified.delete(id);
      throw error;
    }
    finally{reservation.settled=true;this.release()}
  }
}
