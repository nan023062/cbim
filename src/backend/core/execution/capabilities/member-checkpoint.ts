/**
 * 目录归属：backend/core/execution/capabilities；成员运行能力与短期门闩。
 * 作用定位：成员单次合作式停泊的运行时门闩，沿真实工具授权保存非终结检查点请求。
 * 设计原因：向工具冻结完整成员身份及知识版本；保存后即使回包校验失败也封住该轮工具，只有真实成功回执与正常终态才可交给调度核实。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../foundation/errors';
import {MemberCheckpointTools,memberCheckpointToolName} from '../../tasks/member-checkpoint-tools';
import {memberCheckpointInputSchema,memberCheckpointStagedSchema,type MemberCheckpointInput,type MemberCheckpointStaged} from '../../tasks/member-checkpoint';
import {validateCheckpointEligibility} from '../../tasks/member-checkpoint-evidence';
import type {MemberRunBinding} from '../member-run';
import type {StoredEvent} from '../types';
import type {ArtifactCapturePort} from './artifact-capture';
import type {TaskProgress} from '../../evidence/progress';

/** 每个获可信剩余额度的运行只提供一次；续执行可保存下一段，历史失败请求不能伪装新检查点。 */
export class RunMemberCheckpoint {
  readonly tools:MemberCheckpointTools;
  private events:StoredEvent[]=[];
  private reserved?:{id:string;input:MemberCheckpointInput;consumed:boolean};
  private staged=false;
  private controller=new AbortController();
  constructor(private readonly binding:MemberRunBinding,private readonly port:ArtifactCapturePort,private readonly context:{current():TaskProgress|undefined;assertReady(id:string):void;save(value:MemberCheckpointStaged):Promise<void>}){
    this.binding=Object.freeze(structuredClone(binding));
    this.tools=new MemberCheckpointTools(this.binding,{knowledgeRevision:port.knowledgeRevision,stage:(input,id)=>this.stage(input,id)});
  }
  /** 策略或审批 await 之前预占；失败参数可修正，开始保存后永久封住本轮，直到安全结算。 */
  guard(name:string,id:string,input:unknown,active:readonly string[]):string|undefined{
    if(this.staged||this.reserved)return '成员检查点正在交接，请结束本轮；不能再调用工具';
    if(name!==memberCheckpointToolName)return;
    if(this.controller.signal.aborted)return '成员运行已停止，不能申请检查点';
    const parsed=memberCheckpointInputSchema.safeParse(input);if(!parsed.success)return '成员检查点参数无效';
    if(active.length)return '其它工具或审批尚未结束，不能申请成员检查点';
    this.reserved={id,input:parsed.data,consumed:false};
  }
  observed(event:StoredEvent){
    if(event.type==='run.started'||event.type.startsWith('tool.')||event.type==='task.updated'||event.type==='artifact.baseline_captured'||event.type==='task.checkpoint_requested'||event.type==='run.stop_requested')this.events.push(event);
    if(!this.staged&&(event.type==='tool.finished'||event.type==='tool.denied')&&event.data.id===this.reserved?.id)this.reserved=undefined;
  }
  stop(){this.controller.abort(Error('成员运行已停止'))}
  private async stage(input:MemberCheckpointInput,id:string):Promise<MemberCheckpointStaged>{
    if(!this.reserved||this.reserved.id!==id||this.reserved.consumed||!isDeepStrictEqual(this.reserved.input,input))fail('MEMBER_CHECKPOINT_CALL','检查点必须来自本轮授权的一次性调用');
    this.reserved.consumed=true;
    const check=()=>{this.controller.signal.throwIfAborted();this.context.assertReady(id);if(this.context.current()?.version!==input.expectedTaskProgressVersion)fail('MEMBER_CHECKPOINT_PROGRESS','任务进度已变化，请重新核实')};
    check();await this.port.assertCurrentKnowledge();check();
    const eligible=validateCheckpointEligibility(this.events,this.binding,this.port.knowledgeRevision,this.port.normalizePath,input,id);
    const expected=eligible.baseline.baseline.files,files=await this.port.captureFiles(expected.map(file=>file.relativePath),this.controller.signal);check();
    if(files.length!==expected.length||files.some((file,index)=>this.port.normalizePath(file.relativePath)!==this.port.normalizePath(expected[index].relativePath)||file.sha256!==expected[index].sha256||file.byteLength!==expected[index].byteLength))fail('MEMBER_CHECKPOINT_ARTIFACT_CHANGED','文件已偏离所选基线，不能建立检查点');
    await this.port.assertCurrentKnowledge();check();
    validateCheckpointEligibility(this.events,this.binding,this.port.knowledgeRevision,this.port.normalizePath,input,id);
    const value=memberCheckpointStagedSchema.parse({version:1,checkpointId:randomUUID(),toolCallId:id,binding:this.binding,input,knowledgeRevision:this.port.knowledgeRevision,requestedAt:new Date().toISOString(),lastEffectSeq:eligible.lastEffectSeq});
    this.staged=true;await this.context.save(value);check();return value;
  }
}
