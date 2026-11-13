/**
 * 作用定位：成员文件基线列表和显式复核的只读界面状态，校验报告身份及单次观察结果。
 * 设计原因：列表不默认选择或读取文件；切换基线、节点、轮次时作废迟到响应，不把旧复核拼入新报告，也不触发模型或任务恢复。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 * 失效边界：新读取、选择变化和 cancel 推进代次；基线身份与 sourceVersion 仍按原规则核验。
 */
import {AsyncGeneration,SubscriptionSet} from '../foundations/utility';
import {artifactReportSchema,type ArtifactReport,type ArtifactReportInput} from '../../bridge/contracts/dispatch';

export type ArtifactSelection=Omit<ArtifactReportInput,'baselineId'>;
export interface ArtifactReportState {
  report?:ArtifactReport;
  /** 用户明确选择的基线；空串表示尚未选择，不能自动使用最新一份。 */
  selectedId:string;
  loading:boolean;
  error:string;
  /** 发起读取时界面看到的图/任务版本；变化只提示过期，不自动扫描文件。 */
  sourceVersion?:string;
}
export const artifactSelectionKey=(identity:ArtifactSelection)=>JSON.stringify([identity.workspaceId,identity.rootSessionId,identity.taskId,identity.runId]);

/** 校验服务器白名单与结果自洽性；相同哈希只表示所列文件字节，不代表验收或整个工作区。 */
export function checkedArtifactReport(raw:unknown,request:ArtifactReportInput):ArtifactReport{
  const value=artifactReportSchema.parse(raw);
  if(artifactSelectionKey(value.identity)!==artifactSelectionKey(request))throw Error('文件基线报告不属于所选任务或执行轮次');
  if(new Set(value.baselines.map(item=>item.baselineId)).size!==value.baselines.length)throw Error('文件基线列表包含重复记录');
  if(value.log.state!=='verified'&&(value.baselines.length||value.verification&&(value.verification.state!=='unverifiable'||value.verification.files.length)))throw Error('未核实的日志不能提供可信文件基线');
  const verification=value.verification;
  if(!request.baselineId&&verification)throw Error('加载列表不能隐式复核文件');
  if(verification){
    const baseline=value.baselines.find(item=>item.baselineId===verification.baselineId);
    if(verification.baselineId!==request.baselineId||!baseline&&(verification.state!=='unverifiable'||verification.files.length))throw Error('文件复核不是本次明确选择的基线');
    if(new Set(verification.files.map(file=>file.relativePath)).size!==verification.files.length)throw Error('文件复核包含重复路径');
    if(verification.state!=='unverifiable'&&verification.files.length!==baseline!.fileCount)throw Error('文件复核未覆盖本份基线的全部文件');
    if(value.consistency!=='stable'&&verification.state!=='unverifiable')throw Error('读取期间变化的文件记录不能作为确定结果');
    for(const file of verification.files){
      const equal=file.observed?.sha256===file.expected.sha256&&file.observed?.byteLength===file.expected.byteLength;
      if(file.state==='matches'&&!equal||file.state==='changed'&&(!file.observed||equal)||file.state==='missing'&&file.observed)throw Error('文件状态与实际观察不一致');
    }
    if(verification.state==='matches'&&verification.files.some(file=>file.state!=='matches')||verification.state==='changed'&&!verification.files.some(file=>file.state==='changed'||file.state==='missing'))throw Error('文件复核摘要与明细不一致');
  }
  return value;
}

/** 一个控制器只属于一个真实 run；订阅、选择与取消均不访问 IPC。 */
export class ArtifactReportController {
  private value:ArtifactReportState={selectedId:'',loading:false,error:''};
  private readonly generation=new AsyncGeneration();
  private listeners=new SubscriptionSet();
  constructor(readonly identity:ArtifactSelection,private read:(input:ArtifactReportInput)=>Promise<unknown>,private version:()=>string=()=> ''){}
  get snapshot(){return this.value}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(next:ArtifactReportState){this.value=next;this.listeners.notify()}
  /** 卸载只忽略读取结果；后端只读调用不产生可重放操作。 */
  cancel(){this.generation.advance();this.value={...this.value,loading:false}}
  /** 用户选择不读取文件；更换选项清除旧观察，防止旧基线结果留在新选项下面。 */
  select(id:string){
    if(id&&!this.value.report?.baselines.some(item=>item.baselineId===id))throw Error('所选文件基线不在已核实列表中');
    if(id===this.value.selectedId)return;
    this.generation.advance();
    const report=this.value.report?{...this.value.report,verification:undefined}:undefined;
    this.publish({...this.value,report,selectedId:id,loading:false,error:''});
  }
  /** 只列本轮真实记录，不自动选择最新基线或连带读取业务文件。 */
  async list(){await this.pull()}
  /** 只有明确选择才有文件读取；双击合并为同一在途查询，错误保留上次报告供辨认。 */
  async inspect(){if(this.value.selectedId)await this.pull(this.value.selectedId)}
  private async pull(baselineId?:string){
    if(this.value.loading)return;
    const token=this.generation.advance(),sourceVersion=this.version(),request={...this.identity,...(baselineId?{baselineId}:{})};
    this.publish({...this.value,loading:true,error:''});
    try{
      const raw=await this.read(request);if(!this.generation.isCurrent(token))return;
      const report=checkedArtifactReport(raw,request),selectedId=report.baselines.some(item=>item.baselineId===this.value.selectedId)?this.value.selectedId:'';
      this.publish({report,selectedId,loading:false,error:'',sourceVersion});
    }catch(error){if(this.generation.isCurrent(token))this.publish({...this.value,loading:false,error:error instanceof Error?error.message:'文件复核失败，请重新读取'})}
  }
}
