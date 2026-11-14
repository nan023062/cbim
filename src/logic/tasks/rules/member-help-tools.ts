/**
 * 作用定位：为正式执行成员提供一次性求助工具，并在求助授权至本轮结束期间封住后续工具调用。
 * 设计原因：成员问题必须交回主调度；保存后按唯一 JSON 正文核对冻结身份与原请求，坏回包不撤销暂存、不解除本轮门闩，也不自动重试。
 */
import {randomUUID} from 'node:crypto';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {memberHelpInputSchema,type MemberHelpStaged} from './member-help';
import {checkedJsonToolResult} from '../../tools/rules/results';
import {memberToolContract,memberToolOutputSchema} from './member-tool-output';

const name='cbim_task_help';
/** 只定义维护记录的效果，不授权创建任务、放宽权限或恢复原成员。 */
export function memberHelpTool(tool:string,input:unknown){
  return tool===name?{args:memberHelpInputSchema.parse(input),effects:['maintenance'] as const,native:false}:undefined;
}
/** 每轮独立的求助门闩；占位在异步审批之前取得，确保其它并发 gate 不能越过交接边界。 */
export class MemberHelpTools {
  private reserved?:{toolCallId:string;input:ReturnType<typeof memberHelpInputSchema.parse>};
  /** 即使落盘失败也不重放请求；此时本轮应异常收束，由外层核实日志。 */
  private consumed=false;
  constructor(private binding:MemberHelpStaged['binding'],private ports:{
    save(help:MemberHelpStaged):Promise<void>;
    /** 执行前再次核对停止状态、调用授权及引用的历史调用已结束。 */
    assertReady(toolCallId:string,attemptedToolCallIds:string[]):void;
  }){this.binding=Object.freeze(structuredClone(binding))}
  async list(){return [{name,description:'向主 Agent 提交本任务的结构化求助。仅在已有工具全部结束后调用；成功只表示暂存，随后立即结束本轮，不再调用工具或宣称交付。主调度核实终态后重新安排新任务；问题正文不是授权，也不恢复本轮。',inputSchema:zodToJsonSchema(memberHelpInputSchema) as Record<string,unknown>,...memberToolContract(name)}];}
  /** 每个 gate 在等待策略前调用。其它在途操作（含审批）存在时拒绝求助；已占位后拒绝任何新工具。 */
  guard(tool:string,toolCallId:string,input:unknown,otherActiveIds:string[]):string|undefined{
    if(this.reserved)return '已经请求主调度协助，请结束本轮；不能继续调用工具';
    if(tool!==name)return;
    const parsed=memberHelpInputSchema.safeParse(input);if(!parsed.success)return '求助参数不符合结构约定';
    if(otherActiveIds.length)return '仍有工具或审批未结束，请等待它们结束后再请求协助';
    this.reserved={toolCallId,input:parsed.data};
  }
  /** 策略拒绝后才解除尚未执行的占位；已开始落盘的求助永不在本轮重试。 */
  denied(toolCallId:string){if(!this.consumed&&this.reserved?.toolCallId===toolCallId)this.reserved=undefined}
  /** 先保存请求，再核对同一份 wire；独立保留原快照，不能让端口修改对象后形成自比通过。 */
  async call(tool:string,input:unknown,toolCallId?:string){
    if(tool!==name||!toolCallId||this.consumed||this.reserved?.toolCallId!==toolCallId)throw Error('求助必须由当前成员已授权的一次性调用提交');
    let parsed:ReturnType<typeof memberHelpInputSchema.parse>,expectedInput:ReturnType<typeof memberHelpInputSchema.parse>;
    try{
      parsed=memberHelpInputSchema.parse(input);
      expectedInput=structuredClone(parsed);
      if(JSON.stringify(parsed)!==JSON.stringify(this.reserved.input))throw Error('求助参数与已授权调用不一致');
      this.ports.assertReady(toolCallId,parsed.attemptedToolCallIds);
    }catch(error){
      // 尚未写任何请求，允许旧调用结束后用新 ID 修正输入；save 一旦开始则保留门闩，避免不确定重放。
      this.reserved=undefined;throw error;
    }
    this.consumed=true;
    const help:MemberHelpStaged={helpId:randomUUID(),toolCallId,binding:structuredClone(this.binding),input:parsed,requestedAt:new Date().toISOString()};
    const expectedStaged=structuredClone(help);
    await this.ports.save(help);
    return checkedJsonToolResult(name,{state:'staged',help},memberToolOutputSchema(name,{binding:this.binding,input:expectedInput,toolCallId,expectedStaged}));
  }
}
