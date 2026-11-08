/**
 * 作用定位：完整产物清单的显式列表、选择和复核状态；仅消费 Bridge 公开 DTO。
 * 设计原因：范围与集合身份不可拆分，跨节点、轮次及选择的迟到响应必须隔离；旧观察和本次错误分别保留。
 */
import {outputManifestReportSchema,type OutputManifestReport,type OutputManifestQuery} from '../../bridge/contracts/output-manifest';

export type ManifestSelection=Omit<OutputManifestQuery,'manifestId'>;
export interface ManifestReportState {report?:OutputManifestReport;selectedId:string;loading:boolean;error:string;sourceVersion?:string}
export const manifestSelectionKey=(value:ManifestSelection)=>JSON.stringify([value.workspaceId,value.rootSessionId,value.taskId,value.runId]);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** 前端核身份、完整结构与摘要/明细自洽；哈希重算和来源真实性由后端独立完成，不赋予界面验收权。 */
export function checkedManifestReport(raw:unknown,request:OutputManifestQuery):OutputManifestReport{
  const value=outputManifestReportSchema.parse(raw),verification=value.verification;
  if(manifestSelectionKey(value.identity)!==manifestSelectionKey(request))throw Error('完整产物报告不属于所选任务或运行');
  if(new Set(value.manifests.map(item=>item.manifestId)).size!==value.manifests.length||new Set(value.manifests.map(item=>item.captureToolCallId)).size!==value.manifests.length)throw Error('完整产物清单引用重复');
  if(value.manifests.some(item=>!same(item.scopes,value.scopes)||item.fileCount>item.entryCount))throw Error('完整产物清单与冻结范围不一致');
  if(value.log!=='verified'&&(value.scopes||value.manifests.length||verification&&(verification.state!=='unverifiable'||verification.expected||verification.observed)))throw Error('未核实日志不能提供完整产物证明');
  if(!request.manifestId&&verification||request.manifestId&&!verification)throw Error('完整复核未对应本次明确选择');
  if(verification){
    const manifest=value.manifests.find(item=>item.manifestId===verification.manifestId);
    if(verification.manifestId!==request.manifestId||manifest&&verification.expectedHash!==manifest.manifestHash)throw Error('复核换绑了原清单');
    if(value.consistency!=='stable'&&verification.state!=='unverifiable')throw Error('变化期间的读取不能形成稳定结论');
    if(verification.state==='unverifiable'){if(verification.observed||verification.observedHash)throw Error('不可核实结果不能包含部分当前清单')}
    else{
      if(!manifest||!verification.expected||!verification.observed||!verification.observedHash||!same(verification.expected.scopes,value.scopes)||!same(verification.observed.scopes,value.scopes))throw Error('完整复核缺少原范围或当前全部条目');
      const files=verification.expected.entries.filter(item=>item.kind==='file');
      if(manifest.entryCount!==verification.expected.entries.length||manifest.fileCount!==files.length||manifest.byteLength!==files.reduce((sum,file)=>sum+file.byteLength,0))throw Error('原完整清单数量与明细不一致');
      const matches=same(verification.expected,verification.observed);
      if((verification.state==='matches')!==matches||(verification.state==='matches')!==(verification.expectedHash===verification.observedHash))throw Error('完整清单状态与集合及摘要不一致');
    }
  }
  return value;
}
/** 实例只绑定一个 run；构造、订阅、换选择和销毁均不触发文件读取。 */
export class ManifestReportController {
  private value:ManifestReportState={selectedId:'',loading:false,error:''};
  private generation=0;
  private listeners=new Set<()=>void>();
  constructor(readonly identity:ManifestSelection,private read:(input:OutputManifestQuery)=>Promise<unknown>,private version:()=>string=()=> ''){}
  get snapshot(){return this.value}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  private publish(value:ManifestReportState){this.value=value;for(const listener of this.listeners)listener()}
  cancel(){this.generation++;this.value={...this.value,loading:false}}
  /** 选择本身不扫描；清掉上一个选项的观察，未选择时不默认最新。 */
  select(id:string){
    if(id&&!this.value.report?.manifests.some(item=>item.manifestId===id))throw Error('所选清单不在已核实列表中');
    if(id===this.value.selectedId)return;this.generation++;const report=this.value.report?{...this.value.report,verification:undefined}:undefined;
    this.publish({...this.value,report,selectedId:id,loading:false,error:''});
  }
  async list(){await this.pull()}
  async inspect(){if(this.value.selectedId)await this.pull(this.value.selectedId)}
  private async pull(manifestId?:string){
    if(this.value.loading)return;const generation=++this.generation,sourceVersion=this.version(),request={...this.identity,...(manifestId?{manifestId}:{})};this.publish({...this.value,loading:true,error:''});
    try{const raw=await this.read(request);if(generation!==this.generation)return;const report=checkedManifestReport(raw,request),selectedId=report.manifests.some(item=>item.manifestId===this.value.selectedId)?this.value.selectedId:'';this.publish({report,selectedId,loading:false,error:'',sourceVersion})}
    catch(error){if(generation===this.generation)this.publish({...this.value,loading:false,error:error instanceof Error?error.message:'完整产物读取失败，请重试'})}
  }
}
