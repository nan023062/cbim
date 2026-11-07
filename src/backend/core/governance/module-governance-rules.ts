/**
 * 作用定位：模块知识治理的纯事实投影、提案依据、决定追加和知识写入门禁。
 * 设计原因：通用 CRUD 与受控实施必须比较同一真实前后快照，不能只凭工具名称、批准文字或当前正文相同认定获批；纯规则不反向依赖存储队列。
 * 职责边界：调用方负责可信文件读取、完整知识校验、私有记录及 journal 来源；此处不读文件、不签发身份、不执行事务或补造实施成功。
 */
import {hash,json} from '../foundation/serialization';
import {fail} from '../foundation/errors';
import {
  moduleGovernanceProtectionSchema,moduleGovernanceProposalSchema,moduleGovernanceObservationSchema,moduleGovernanceDecisionSchema,moduleGovernanceApplyIntentSchema,moduleGovernanceKnowledgeReceiptSchema,
  type ModuleGovernanceProtection,type ModuleGovernanceProposal,type ModuleGovernanceObservation,type ModuleGovernanceDecision,type ModuleGovernanceApplyIntent,type ModuleGovernanceKnowledgeReceipt,
} from './module-governance';

/** 结构与知识文件一致但不导入知识端口，避免知识存储与治理契约之间形成类型依赖环。 */
export interface ModuleGovernanceFile {path:string;text:string;hash:string}
export interface ModuleGovernanceWriteRequest {workspaceId:string;instanceId:string;revision:string;requestId:string;changes:{path:string;text:string|null}[]}
function check(condition:unknown,code:string,message:string):asserts condition{if(!condition)fail(code,message)}
function fileMap(files:readonly ModuleGovernanceFile[]){
  const map=new Map<string,ModuleGovernanceFile>(),seen=new Set<string>();
  for(const file of files){const folded=file.path.toLowerCase();check(!seen.has(folded),'GOVERNANCE_IDENTITY','知识快照含重复路径，无法核实保护对象');seen.add(folded);map.set(file.path,file)}return map;
}
function readFact(files:Map<string,ModuleGovernanceFile>,path:string){const file=files.get(path);check(file&&file.hash===hash(file.text),'GOVERNANCE_DRIFT','受保护知识缺失或文件指纹不一致');return file}
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}

/** 只登记已被实际知识索引公开的 Module；现行 module.schema 的 overview 固定为 module.md，仍须解析真实定义核对绑定。 */
export function moduleGovernanceBinding(moduleId:string,files:readonly ModuleGovernanceFile[],visibleModuleIds:readonly string[]){
  check(/^\.cbim\/workspace\/(?:[a-z0-9_]+\/)*[a-z0-9_]+$/.test(moduleId),'GOVERNANCE_IDENTITY','模块标识不是受支持的正式 Module');
  check(visibleModuleIds.includes(moduleId),'GOVERNANCE_PROTECTED','受保护模块必须保持在正式模块索引中可见');
  const map=fileMap(files),definition=readFact(map,moduleId+'/module.json');let value:unknown;
  try{value=JSON.parse(definition.text)}catch{fail('GOVERNANCE_DRIFT','受保护模块定义不是有效 JSON')}
  check(value&&typeof value==='object'&&!Array.isArray(value),'GOVERNANCE_DRIFT','受保护模块定义无效');
  const data=value as Record<string,unknown>;
  check(data.id===moduleId&&data.overview==='module.md','GOVERNANCE_PROTECTED','受保护模块身份或正文绑定不可改变');
  const overview=readFact(map,moduleId+'/'+data.overview);
  return {definition:{path:definition.path,hash:definition.hash},overview:{path:overview.path,hash:overview.hash}};
}

/** 时钟不参与 basis；精确正文、主体、版本和取舍说明均参与，不能用相同文件结果掩盖变更的方案。 */
export function moduleGovernanceProposalBasis(proposal:Omit<ModuleGovernanceProposal,'basis'>|ModuleGovernanceProposal):string{
  const {basis:_,createdAt:__,...subject}=proposal as ModuleGovernanceProposal;return hash(canonical(subject));
}
/** 提案必须从该保护对象的一次真实冻结观察形成；不能把新版本与更旧正文混在一起。 */
export function validateModuleGovernanceProposal(raw:ModuleGovernanceProposal,rawProtection:ModuleGovernanceProtection,rawObservation:ModuleGovernanceObservation):void{
  const p=moduleGovernanceProposalSchema.parse(raw),protection=moduleGovernanceProtectionSchema.parse(rawProtection),observation=moduleGovernanceObservationSchema.parse(rawObservation);
  check(p.workspaceId===protection.workspaceId&&p.workspaceId===observation.workspaceId&&p.moduleId===protection.moduleId&&p.protectionId===protection.protectionId&&p.protectionId===observation.protectionId&&p.observationId===observation.observationId,'GOVERNANCE_IDENTITY','提案、观察和保护对象身份不一致');
  check(p.base.protectionRevision===protection.revision&&observation.protectionRevision===protection.revision&&p.base.knowledgeRevision===observation.knowledgeRevision&&p.base.definitionHash===protection.definition.hash&&observation.definitionHash===protection.definition.hash&&p.base.overviewHash===protection.overview.hash&&observation.overviewHash===protection.overview.hash,'GOVERNANCE_STALE','提案或观察的知识/保护基线已过期');
  check(p.change.path===protection.overview.path&&observation.overview.path===protection.overview.path&&observation.overview.hash===protection.overview.hash&&hash(observation.overview.text)===observation.overview.hash&&p.change.beforeText===observation.overview.text,'GOVERNANCE_PROTECTED','提案只能更新观察时已绑定的 overview 正文');
  check(p.change.beforeHash===hash(p.change.beforeText)&&p.change.beforeHash===protection.overview.hash&&p.change.afterHash===hash(p.change.afterText)&&p.change.beforeHash!==p.change.afterHash,'GOVERNANCE_PROPOSAL','提案差异不存在或正文指纹不一致');
  check(p.basis===moduleGovernanceProposalBasis(p),'GOVERNANCE_PROPOSAL','提案依据与冻结内容不一致');
}

/** 同一不可变提案的决定连续追加；拒绝/暂缓不删除旧批准，最后一条才代表当前决定。 */
export function validateModuleGovernanceDecisionAppend(previous:readonly ModuleGovernanceDecision[],rawNext:ModuleGovernanceDecision):void{
  const next=moduleGovernanceDecisionSchema.parse(rawNext),all=[...previous,next],ids=new Set<string>();
  check(all.length<=128,'GOVERNANCE_LIMIT','该提案决定记录已达到上限');
  for(let index=0;index<all.length;index++){
    const record=moduleGovernanceDecisionSchema.parse(all[index]);
    check(!ids.has(record.decisionId)&&record.workspaceId===next.workspaceId&&record.proposalId===next.proposalId&&record.basis===next.basis&&record.revision===index+1&&record.supersedesDecisionId===(index?all[index-1].decisionId:undefined),'GOVERNANCE_DECISION','决定历史不连续或不属于同一提案依据');ids.add(record.decisionId);
  }
}

/** 授权对象必须由知识事务持锁读取真实私有账本；该类型不进入任何通用 CRUD 或模型输入 Schema。 */
export interface ModuleGovernanceWriteAuthorization {intent:ModuleGovernanceApplyIntent;proposal:ModuleGovernanceProposal;decision:ModuleGovernanceDecision;latestDecisionRevision:number}
export interface ModuleGovernanceWriteInput {
  workspaceId:string;currentRevision:string;request:ModuleGovernanceWriteRequest;protections:readonly ModuleGovernanceProtection[];
  currentFiles:readonly ModuleGovernanceFile[];projectedFiles:readonly ModuleGovernanceFile[];
  /** 完整 projected validation 派生的可见模块 ID；不能只看文件仍存在，从而允许 ignore 隐藏对象。 */
  visibleModuleIds:readonly string[];authorized?:ModuleGovernanceWriteAuthorization;
}
/**
 * 检查普通知识写与专属实施的同一最终投影。只许授权 intent 的唯一 overview 差异；派生索引由既有知识事务生成。
 * 不做存储读取或申请权限；调用方必须先核当前知识版本、完整结构、最新决定及 intent 的真实来源。
 */
export function validateModuleGovernanceWrite(input:ModuleGovernanceWriteInput):void{
  check(input.request.workspaceId===input.workspaceId&&input.request.revision===input.currentRevision,'GOVERNANCE_IDENTITY','知识事务不属于当前治理工作区或版本');
  const oldFiles=fileMap(input.currentFiles),nextFiles=fileMap(input.projectedFiles),ids=new Set<string>(),modules=new Set<string>();
  const protections=input.protections.map(raw=>moduleGovernanceProtectionSchema.parse(raw));
  for(const protection of protections){
    check(protection.workspaceId===input.workspaceId&&!ids.has(protection.protectionId)&&!modules.has(protection.moduleId.toLowerCase()),'GOVERNANCE_IDENTITY','保护登记跨工作区或含重复身份');ids.add(protection.protectionId);modules.add(protection.moduleId.toLowerCase());
    check(protection.definition.path===protection.moduleId+'/module.json'&&protection.overview.path===protection.moduleId+'/module.md','GOVERNANCE_PROTECTED','保护登记与真实 Module 文件绑定不一致');
    const oldDefinition=readFact(oldFiles,protection.definition.path),oldOverview=readFact(oldFiles,protection.overview.path);
    check(oldDefinition.hash===protection.definition.hash&&oldOverview.hash===protection.overview.hash,'GOVERNANCE_DRIFT','受保护知识已偏离登记或原实施 journal，不能追认外部改动');
    const binding=moduleGovernanceBinding(protection.moduleId,input.projectedFiles,input.visibleModuleIds);
    check(binding.definition.hash===protection.definition.hash&&binding.overview.path===protection.overview.path,'GOVERNANCE_PROTECTED','本片不允许变更、移动、删除受保护定义或更换正文绑定');
    if(!input.authorized||input.authorized.intent.protectionId!==protection.protectionId)check(binding.overview.hash===protection.overview.hash,'GOVERNANCE_PROTECTED','受保护正文须通过精确获批提案的独立实施入口');
  }
  if(!input.authorized)return;
  const {latestDecisionRevision}=input.authorized,intent=moduleGovernanceApplyIntentSchema.parse(input.authorized.intent),proposal=moduleGovernanceProposalSchema.parse(input.authorized.proposal),decision=moduleGovernanceDecisionSchema.parse(input.authorized.decision);
  const protection=protections.find(item=>item.protectionId===intent.protectionId);
  check(protection,'GOVERNANCE_IDENTITY','实施意图没有对应的保护登记');
  check(intent.workspaceId===input.workspaceId&&intent.request.workspaceId===input.workspaceId&&proposal.workspaceId===input.workspaceId&&decision.workspaceId===input.workspaceId&&proposal.moduleId===protection.moduleId&&intent.protectionId===proposal.protectionId&&intent.proposalId===proposal.proposalId&&intent.decisionId===decision.decisionId&&decision.proposalId===proposal.proposalId,'GOVERNANCE_IDENTITY','实施、提案和决定身份不一致');
  check(decision.decision==='approve'&&decision.revision===latestDecisionRevision&&decision.basis===proposal.basis&&intent.basis===proposal.basis&&proposal.basis===moduleGovernanceProposalBasis(proposal),'GOVERNANCE_DECISION','必须使用原提案当前最新的有效批准');
  check(proposal.base.knowledgeRevision===input.currentRevision&&proposal.base.protectionRevision===protection.revision&&proposal.base.definitionHash===protection.definition.hash&&proposal.base.overviewHash===protection.overview.hash,'GOVERNANCE_STALE','获批提案的知识或保护版本已变化');
  check(intent.request.requestId===intent.intentId&&intent.request.revision===input.currentRevision&&intent.requestFingerprint===hash(json(intent.request))&&intent.requestFingerprint===hash(json(input.request)),'GOVERNANCE_INTENT','实施意图与本次原知识请求不一致');
  const change=intent.request.changes[0],next=readFact(nextFiles,protection.overview.path),before=readFact(oldFiles,protection.overview.path);
  check(proposal.change.path===protection.overview.path&&proposal.change.beforeText===before.text&&proposal.change.beforeHash===before.hash&&proposal.change.afterHash===hash(proposal.change.afterText)&&proposal.change.beforeHash!==proposal.change.afterHash&&change.path===protection.overview.path&&change.text===proposal.change.afterText&&next.hash===proposal.change.afterHash&&next.text===proposal.change.afterText,'GOVERNANCE_PROTECTED','实施请求只允许原批准的唯一 overview 正文差异');
  for(const path of new Set([...oldFiles.keys(),...nextFiles.keys()]))if(oldFiles.get(path)?.hash!==nextFiles.get(path)?.hash)check(path===protection.overview.path||path==='.cbim/team/registry.json'||path==='.cbim/workspace/registry.json','GOVERNANCE_PROTECTED','受控实施不能夹带其他知识文件变更');
}

/** 只基于已核实治理绑定的 committed journal 推导下一保护基线；存储不得把 pending 意图当成此回执。 */
export function advanceModuleGovernanceProtection(raw:ModuleGovernanceProtection,proposal:ModuleGovernanceProposal,rawReceipt:ModuleGovernanceKnowledgeReceipt):ModuleGovernanceProtection{
  const protection=moduleGovernanceProtectionSchema.parse(raw),receipt=moduleGovernanceKnowledgeReceiptSchema.parse(rawReceipt);
  check(protection.workspaceId===receipt.workspaceId&&proposal.workspaceId===receipt.workspaceId&&proposal.protectionId===protection.protectionId&&proposal.moduleId===protection.moduleId&&proposal.base.protectionRevision===protection.revision&&proposal.base.definitionHash===protection.definition.hash&&proposal.base.overviewHash===protection.overview.hash&&proposal.change.path===protection.overview.path&&proposal.change.beforeHash===protection.overview.hash&&proposal.change.afterHash===hash(proposal.change.afterText)&&proposal.basis===moduleGovernanceProposalBasis(proposal)&&receipt.changed.includes(protection.overview.path)&&!receipt.changed.includes(protection.definition.path),'GOVERNANCE_RECEIPT','知识回执不能推进此保护对象基线');
  check(protection.revision<Number.MAX_SAFE_INTEGER,'GOVERNANCE_LIMIT','保护版本已达到上限');
  return {...protection,revision:protection.revision+1,overview:{...protection.overview,hash:proposal.change.afterHash}};
}
