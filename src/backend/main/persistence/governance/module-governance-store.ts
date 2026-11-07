/**
 * 作用定位：保存工作区私有的保护登记、观察、提案、决定及原实施意图。
 * 设计原因：账本只有追加命令，独立世代/字节锚防丢失回退；没有可冒充知识提交的 applied 缓存，已生效状态须由原知识 journal 推导。
 * 职责边界：本类不拥有队列、不回调工作区；调用方必须持有 KnowledgeStore 的同一串行屏障。
 * 来源边界：新观察/提案的可信来源进入原命令指纹；旧缺省不补造，模型命令须能从真实来源重算。
 */
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {atomic} from '../../../core/foundation/files';
import {hash,json} from '../../../core/foundation/serialization';
import {fail} from '../../../core/foundation/errors';
import {moduleGovernanceRegisterInputSchema,moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,moduleGovernanceDecideInputSchema,moduleGovernanceApplyInputSchema,moduleGovernanceReceiptSchema,moduleGovernanceApplyIntentSchema,type ModuleGovernanceReceipt,type ModuleGovernanceApplyIntent,type ModuleGovernanceProtection,type ModuleGovernanceProposal,type ModuleGovernanceObservation,type ModuleGovernanceDecision} from '../../../core/governance/module-governance';
import {validateModuleGovernanceProposal,validateModuleGovernanceDecisionAppend,validateModuleGovernanceRecordOrigin,validateModuleGovernanceMainObservation} from '../../../core/governance/module-governance-rules';
import {moduleGovernanceOriginSchema} from '../../../core/governance/module-governance';

const inputSchema=z.union([moduleGovernanceRegisterInputSchema,moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,moduleGovernanceDecideInputSchema,moduleGovernanceApplyInputSchema]);
const commandSchema=z.object({input:inputSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),receipt:moduleGovernanceReceiptSchema,intent:moduleGovernanceApplyIntentSchema.optional(),origin:moduleGovernanceOriginSchema.optional()}).strict();
const ledgerSchema=z.object({version:z.literal(1),workspaceId:z.string(),ledgerId:z.string().uuid(),commands:z.array(commandSchema).max(512)}).strict();
const headSchema=z.object({revision:z.number().int().min(0).max(512),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const anchorSchema=z.object({version:z.literal(1),workspaceId:z.string(),ledgerId:z.string().uuid(),head:headSchema,pending:headSchema.optional()}).strict();
export type GovernanceCommand=z.infer<typeof commandSchema>;
/** 旧记录不补来源且沿用原指纹；新来源是可信封装的一部分，不能从模型请求解析。 */
export function governanceCommandFingerprint(action:ModuleGovernanceReceipt['action'],input:unknown,origin?:GovernanceCommand['origin']){return hash(json({action,input,...(origin?{origin}:{})}))}
export const governanceLedgerLimit=32*1024*1024;
const same=(a:unknown,b:unknown)=>json(a)===json(b);
function valid(value:unknown,message:string):asserts value{if(!value)fail('GOVERNANCE_DATA',message)}

/** 文件是用户应用数据，不属于 .cbim；正文、决定和身份均通过完整链校验后才供门禁使用。 */
export class ModuleGovernanceStore {
  private commands:GovernanceCommand[]=[];
  private anchor?:z.infer<typeof anchorSchema>;private uncertain=false;
  constructor(private readonly filename:string,readonly workspaceId:string){}
  private get anchorFile(){return this.filename+'.anchor'}
  private async bytes(file:string,limit:number){try{const stat=await fs.lstat(file);valid(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=limit,'治理记录不是受支持的有界普通文件');const bytes=await fs.readFile(file);valid(bytes.length<=limit,'治理记录超过读取上限');return bytes}catch(error:any){if(error.code==='ENOENT')return;throw error}}
  async init(){
    try{
      const bytes=await this.bytes(this.filename,governanceLedgerLimit),anchorBytes=await this.bytes(this.anchorFile,4096);let anchor=anchorBytes?anchorSchema.parse(JSON.parse(anchorBytes.toString('utf8'))):undefined;
      if(!bytes){valid(!anchor,'治理账本丢失，不能将既有保护重置为空');const ledgerId=randomUUID(),encoded=json({version:1,workspaceId:this.workspaceId,ledgerId,commands:[]});anchor={version:1,workspaceId:this.workspaceId,ledgerId,head:{revision:0,hash:hash(encoded)}};await atomic(this.filename,encoded);await atomic(this.anchorFile,json(anchor));this.anchor=anchor;return}
      const value=ledgerSchema.parse(JSON.parse(bytes.toString('utf8')));valid(value.workspaceId===this.workspaceId,'治理账本工作区身份不一致');this.validate(value.commands);const head={revision:value.commands.length,hash:hash(bytes)};
      if(!anchor){valid(value.commands.length===0,'非空治理账本缺少完整性锚');anchor={version:1,workspaceId:this.workspaceId,ledgerId:value.ledgerId,head};await atomic(this.anchorFile,json(anchor))}
      valid(anchor.workspaceId===this.workspaceId&&anchor.ledgerId===value.ledgerId,'治理账本与完整性锚身份不一致');
      const committed=same(anchor.head,head),pending=anchor.pending&&same(anchor.pending,head)&&anchor.pending.revision===anchor.head.revision+1;
      valid(committed||pending,'治理账本被截断、回退或篡改，不能解除保护');
      if(anchor.pending){anchor={version:1,workspaceId:this.workspaceId,ledgerId:value.ledgerId,head};await atomic(this.anchorFile,json(anchor))}
      this.anchor=anchor;this.commands=value.commands;
    }catch(error:any){if(error.code==='GOVERNANCE_DATA')throw error;fail('GOVERNANCE_DATA','治理账本损坏，未解除已登记保护；请核实本地记录')}
  }
  private current(){if(this.uncertain||!this.anchor)fail('GOVERNANCE_DATA','治理账本写入结果未知，请重开核实原记录；当前保护未解除')}
  all():readonly GovernanceCommand[]{this.current();return structuredClone(this.commands)}
  find(commandId:string){this.current();return structuredClone(this.commands.find(command=>command.receipt.commandId===commandId))}
  /** 磁盘写入成功后才发布新状态；失败保留原账本，不静默裁剪历史。 */
  async append(command:GovernanceCommand){
    this.current();const parsed=commandSchema.parse(command),next=[...this.commands,parsed];this.validate(next);const encoded=json({version:1,workspaceId:this.workspaceId,ledgerId:this.anchor!.ledgerId,commands:next});if(Buffer.byteLength(encoded)>governanceLedgerLimit||next.length>512)fail('GOVERNANCE_LIMIT','治理历史已达本机有界上限，未保存新命令');
    const pending={revision:next.length,hash:hash(encoded)},anchor={...this.anchor!,pending};
    try{await atomic(this.anchorFile,json(anchor));await atomic(this.filename,encoded);const completed={version:1 as const,workspaceId:this.workspaceId,ledgerId:anchor.ledgerId,head:pending};await atomic(this.anchorFile,json(completed));this.anchor=completed;this.commands=next}catch(error){this.uncertain=true;throw error}
  }
  private validate(commands:GovernanceCommand[]){
    const ids=new Set<string>(),protections=new Map<string,ModuleGovernanceProtection>(),modules=new Set<string>(),observations=new Map<string,ModuleGovernanceObservation>(),proposals=new Map<string,ModuleGovernanceProposal>(),decisions=new Map<string,ModuleGovernanceDecision[]>();
    for(const command of commands){
      const {input,receipt,intent,origin}=command,id=receipt.commandId;
      valid(!ids.has(id)&&input.commandId===id&&command.fingerprint===governanceCommandFingerprint(receipt.action,input,origin),'治理命令重复或原请求指纹不一致');ids.add(id);
      valid(input.workspaceId===this.workspaceId&&receipt.identity.workspaceId===this.workspaceId&&receipt.identity.instanceId===input.instanceId&&receipt.record.workspaceId===this.workspaceId,'治理命令身份不一致');
      if(receipt.action==='observe'||receipt.action==='propose'){valid(same(receipt.record.origin,origin),'治理记录与原命令来源不一致');validateModuleGovernanceRecordOrigin(receipt.record)}else valid(!origin,'只有观察或提案能携带治理工具来源');
      if(receipt.action!=='apply')valid(!intent,'普通治理命令不能持有实施意图');
      if(receipt.action==='register'){
        const value=receipt.record,request=moduleGovernanceRegisterInputSchema.parse(input);valid(value.protectionId===id&&value.moduleId===request.moduleId&&value.revision===1&&!protections.has(id)&&!modules.has(value.moduleId),'保护登记不唯一或初始版本无效');protections.set(id,value);modules.add(value.moduleId);
      }else if(receipt.action==='observe'){
        const value=receipt.record,request=moduleGovernanceObserveInputSchema.parse(input),protection=protections.get(value.protectionId);
        valid(protection&&value.observationId===id&&value.protectionId===request.protectionId&&value.protectionRevision===request.expectedProtectionRevision&&value.knowledgeRevision===request.expectedKnowledgeRevision&&value.statement===request.statement&&value.definitionHash===protection.definition.hash&&value.overview.path===protection.overview.path&&value.overview.hash===value.overviewHash&&hash(value.overview.text)===value.overviewHash,'观察缺少真实保护来源或正文指纹不一致');observations.set(id,value);
      }else if(receipt.action==='propose'){
        const value=receipt.record,request=moduleGovernanceProposeInputSchema.parse(input),protection=protections.get(value.protectionId),observation=observations.get(value.observationId);
        valid(protection&&observation&&value.proposalId===id&&value.protectionId===request.protectionId&&value.observationId===request.observationId&&value.base.protectionRevision===request.expectedProtectionRevision&&value.base.knowledgeRevision===request.expectedKnowledgeRevision&&value.change.afterText===request.newOverviewText&&value.reason===request.reason&&same(value.alternatives,request.alternatives)&&same(value.invariants,request.invariants)&&value.rollbackNotes===request.rollbackNotes,'提案与原请求或观察不一致');
        validateModuleGovernanceProposal(value,{...protection,revision:observation.protectionRevision,overview:{path:protection.overview.path,hash:observation.overviewHash}},observation);if(origin?.kind==='main_agent')validateModuleGovernanceMainObservation(observation,origin);proposals.set(id,value);
      }else if(receipt.action==='decide'){
        const value=receipt.record,request=moduleGovernanceDecideInputSchema.parse(input),proposal=proposals.get(value.proposalId),previous=decisions.get(value.proposalId)??[];
        valid(proposal&&value.decisionId===id&&value.proposalId===request.proposalId&&value.basis===proposal.basis&&value.basis===request.expectedBasis&&value.revision===request.expectedDecisionRevision+1&&value.decision===request.decision&&value.comment===request.comment&&value.revisitCondition===request.revisitCondition,'决定与原提案或请求不一致');validateModuleGovernanceDecisionAppend(previous,value);decisions.set(value.proposalId,[...previous,value]);
      }else{
        const value=receipt.record,request=moduleGovernanceApplyInputSchema.parse(input),proposal=proposals.get(value.proposalId),decision=decisions.get(value.proposalId)?.at(-1);
        valid(intent&&value.state==='pending'&&value.intentId===id&&intent.intentId===id&&value.requestId===id&&intent.request.requestId===id&&intent.request.instanceId===input.instanceId&&intent.request.workspaceId===this.workspaceId,'实施意图缺失或伪造已提交缓存');
        valid(proposal&&decision&&decision.decision==='approve'&&decision.decisionId===request.decisionId&&intent.decisionId===decision.decisionId&&value.decisionId===decision.decisionId&&request.proposalId===proposal.proposalId&&intent.proposalId===proposal.proposalId&&value.proposalId===proposal.proposalId&&intent.protectionId===proposal.protectionId&&value.protectionId===proposal.protectionId&&intent.basis===proposal.basis&&value.basis===proposal.basis&&request.expectedBasis===proposal.basis,'实施意图不是当时最新批准的精确提案');
        valid(intent.requestFingerprint===hash(json(intent.request))&&value.requestFingerprint===intent.requestFingerprint&&value.createdAt===intent.createdAt&&intent.workspaceId===this.workspaceId&&intent.request.revision===proposal.base.knowledgeRevision&&same(intent.request.changes,[{path:proposal.change.path,text:proposal.change.afterText}]),'实施意图原知识请求不一致');
      }
    }
  }
}
