/**
 * 作用定位：本机知识存储，承担初始化、快照、预览、串行事务、索引写入和崩溃恢复。
 * 设计原因：从工作区生命周期抽离物理事务；治理与普通写入共用串行门禁，批准不能从模型 ChangeRequest 注入。
 * 回执边界：可按完整原请求只读核实已提交 journal；新来源 prepared 先于 Store pending，正式知识获准后才写入。committed 之后的来源结算和日志失败不回滚，重开只补原终态，不重放知识请求。
 */
import fs from 'node:fs/promises';
import {readKnowledge} from './files';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,exists,readJson} from '../../../core/foundation/files';
import {hash,json} from '../../../core/foundation/serialization';
import {fail} from '../../../core/foundation/errors';
import type {StoragePaths} from '../../../core/foundation/paths';
import {Rules,revision,INDEXES,isKnowledge,parseJson} from '../../../core/knowledge/knowledge';
import type {Snapshot,ChangeRequest,Preview,Change} from '../../../core/knowledge/types';
import type {KnowledgeGovernanceAuthority,KnowledgeGovernanceBinding,KnowledgeGovernanceTransaction,KnowledgeJournalStatus} from './governance-port';
import {readKnowledgePlan} from './planned-commit';
import type {KnowledgePlanRef,PlannedKnowledgeCommit} from '../../../core/knowledge/planned-commit';
import {plannedRequestSchema} from '../../../core/knowledge/planned-commit';
import {checkedSourceJournal,type KnowledgeSourceAuthority,type KnowledgeSourceJournal} from './source-journal';

/** 存储通过此端口报告实例状态；不持有 Electron 或工作区执行管理器。 */
export interface KnowledgeStoreOwner {
 readonly entry:{id:string;path:string}; readonly instanceId:string; readonly paths:StoragePaths; readonly rules:Rules;
 state:string; error?:string; knowledgeErrors:number; lastRevision:string; changed:boolean;
 readonly fault?: (step:number)=>void;
 assert(identity?:{workspaceId:string;instanceId:string}):void;
}
interface CommitResult {state:string;workspaceId:string;instanceId:string;requestId:string;revision:string;changed:string[]}
interface Journal {version:1;workspaceId:string;requestId:string;fingerprint:string;state:'prepared'|'committing'|'committed'|'rolled_back'|'recovery_required';before:Record<string,string|null>;after:Record<string,string|null>;result?:CommitResult;governance?:KnowledgeGovernanceBinding;source?:KnowledgeSourceJournal}
/** 工作区持有一个存储实例，关闭前等待 drain，观察器避开正在提交的事务。 */
export class KnowledgeStore {
 private queue:Promise<unknown>=Promise.resolve();
 activeOperations=0;
 constructor(private owner:KnowledgeStoreOwner,private log:(event:string,details?:Record<string,unknown>)=>Promise<void>,private governance?:KnowledgeGovernanceAuthority,private sources?:KnowledgeSourceAuthority){}
 /** 工作区持锁后只装配一次；必须在恢复和对外开放之前设置同一个 DispatchStore 协调器。 */
 attachSources(sources:KnowledgeSourceAuthority){if(this.sources&&this.sources!==sources)fail('SOURCE_UNAVAILABLE','来源协调器不可替换');this.sources=sources}
 /** 固定知识观察后允许一个短 Store 事务；回调不能重入本队列。 */
 withSourceSnapshot<T>(operation:(snapshot:Snapshot)=>Promise<T>):Promise<T>{this.owner.assert();return this.serial(async()=>{this.owner.assert();this.activeOperations++;try{return await operation(await this.snapshot())}finally{this.activeOperations--}})}
 /** 等待已经进入队列的事务结束；不会取消半完成提交。 */
 async drain(){await this.queue}
  /** 只读核实原请求的已提交回执，允许查询旧实例请求；不执行提交、回滚或恢复。 */
  async committedReceipt(request:ChangeRequest):Promise<CommitResult|undefined>{
    this.owner.assert();return this.serial(async()=>{this.owner.assert();return (await this.journalStatus(request))?.result});
  }
  /** 同串行事务内部的只读查询；允许旧实例身份，但不执行恢复或写入。 */
  private async journalStatus(request:ChangeRequest):Promise<KnowledgeJournalStatus|undefined>{
    if(request.workspaceId!==this.owner.entry.id||!/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId))fail('IDENTITY','知识回执查询身份不匹配');
    const file=path.join(this.owner.paths.local(this.owner.entry.id,'transactions'),request.requestId+'.json');let value:Journal;
      try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)fail('RECOVERY','知识事务记录不安全或过大');value=await readJson<Journal>(file)}catch(error:any){if(error.code==='ENOENT')return undefined;throw error}
      if(value.version!==1||value.workspaceId!==request.workspaceId||value.requestId!==request.requestId||value.fingerprint!==hash(json(request)))fail('IDEMPOTENCY','原知识事务与请求不一致，请核实记录');
      if(!['prepared','committing','committed','rolled_back','recovery_required'].includes(value.state))fail('RECOVERY','知识事务状态无效');
      if(value.governance&&(!['intentId','protectionId','proposalId','decisionId'].every(key=>typeof value.governance?.[key as keyof KnowledgeGovernanceBinding]==='string')||Object.keys(value.governance).length!==4))fail('RECOVERY','知识事务治理来源无效');
      const map=(item:unknown):item is Record<string,string|null>=>!!item&&typeof item==='object'&&!Array.isArray(item)&&Object.entries(item).every(([key,text])=>isKnowledge(key)&&(text===null||typeof text==='string'));
      if(!map(value.before)||!map(value.after)||json(Object.keys(value.before).sort())!==json(Object.keys(value.after).sort())||request.changes.some(change=>!Object.hasOwn(value.after,change.path)||value.after[change.path]!==change.text)||Object.keys(value.after).some(key=>!request.changes.some(change=>change.path===key)&&!INDEXES.includes(key)))fail('RECOVERY','原知识事务前后正文与请求不一致');
      if(value.source){const source=checkedSourceJournal(value.source,value.before,value.after,request);if(!this.sources)fail('SOURCE_UNAVAILABLE','来源事务缺少协调器');await this.sources.verify(source,value.state!=='prepared'&&value.state!=='rolled_back')}
      if(!value.source&&this.sources&&(await this.sources.transitions()).some(item=>item.requestId===request.requestId))fail('SOURCE_JOURNAL_INVALID','原来源事务的 journal 标记缺失，不能降级为旧知识回执');
      const status:KnowledgeJournalStatus={state:value.state,before:structuredClone(value.before),after:structuredClone(value.after),...(value.governance?{governance:structuredClone(value.governance)}:{})};
      if(value.state==='committed'){const result=value.result;if(!result||result.state!=='committed'||result.workspaceId!==request.workspaceId||result.instanceId!==request.instanceId||result.requestId!==request.requestId||typeof result.revision!=='string'||!Array.isArray(result.changed)||result.changed.some(item=>typeof item!=='string')||json([...result.changed].sort())!==json(Object.keys(value.after).sort()))fail('RECOVERY','已提交知识事务缺少有效回执');status.result=structuredClone(result)}
      this.governance?.verifyJournal(request,status);return status;
  }
  /** 私有治理操作与所有知识提交共用一个队列；回调中的 apply 只解析已保存的真实意图。 */
  governed<T>(operation:(transaction:KnowledgeGovernanceTransaction)=>Promise<T>):Promise<T>{
    return this.serial(async()=>{this.owner.assert();this.activeOperations++;try{return await operation({snapshot:()=>this.snapshot(),preview:request=>this.draft(request),journal:request=>this.journalStatus(request),apply:async intentId=>{
      if(!this.governance)fail('GOVERNANCE_UNAVAILABLE','治理存储尚未装配');const request=await this.governance.request(intentId);return this.commitInternal(request,intentId);
    }})}finally{this.activeOperations--}});
  }
  /** 仅证明原请求是否有任何事务记录；已回滚/未完成也算存在，不冒称从未受理。 */
  async hasRecordedRequest(request:ChangeRequest):Promise<boolean>{this.owner.assert();if(request.workspaceId!==this.owner.entry.id||!/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId))fail('IDENTITY','知识回执查询身份不匹配');return this.serial(async()=>{this.owner.assert();try{await fs.lstat(path.join(this.owner.paths.local(this.owner.entry.id,'transactions'),request.requestId+'.json'));return true}catch(error:any){if(error.code==='ENOENT')return false;throw error}})}
  async initialize(){
    const dir=path.join(this.owner.entry.path,'.cbim');
    if(await exists(dir)){await this.owner.paths.knowledge(this.owner.entry.path,'.cbim/project.json');const manifest=path.join(dir,'project.json');
      if(await exists(manifest)){const d=await readJson(manifest);if(d.formatVersion!==1||d.rulesVersion!==1)fail('INCOMPATIBLE','知识版本不兼容；请备份并 review 迁移方案，程序不会自动重写')}
      for(const required of ['workspace','team','connectors'])if(!await exists(path.join(dir,required)))fail('INCOMPATIBLE',`已有 .cbim 缺少 ${required}；请先补全或迁移，不覆盖现有内容`);return;
    }
    // Build a complete template alongside the target, then rename on the same volume.
    const staging=path.join(this.owner.entry.path,`.cbim-init-${this.owner.instanceId}`);await fs.mkdir(staging);
    try{for(const folder of ['workspace','team','team/skills','connectors'])await fs.mkdir(path.join(staging,folder));
      const initial:Record<string,unknown>={'project.json':{formatVersion:1,rulesVersion:1},'team/registry.json':{groups:[]},'team/people.json':{people:[]},'team/skills.json':{skills:[]},'workspace/registry.json':{modules:[]},'connectors/registry.json':{connectors:[]}};
      for(const [p,value]of Object.entries(initial))await atomic(path.join(staging,p),json(value));
      await atomic(path.join(staging,'README.md'),`# CBIM 生产与治理体系

此目录保存当前项目经 review 的正式团队能力与业务知识。

主 Agent 和团队成员通过内部 Loop 的 cbim_ 工具查询知识、获取 Skill 和执行治理；知识写入须经过本次运行授权、版本检查和事务校验。

## 团队能力树

team/ 是根 Team，中间非叶子节点是小组，叶子节点是 Agent。
Team、小组和 Agent 各自维护 Skill：Team 与小组通过 skills.json 登记，Agent 通过 agent.json.skills 登记，正文位于所属节点 skills/<slug>/SKILL.md。
Agent 可用 Skill 为自身 Skill 与沿父链递归到根 Team 的全部祖先 Skill；不继承兄弟节点的 Skill。
空团队的根仍是 Team，不因尚无成员而变成 Agent。

## 业务模块树

workspace/ 是业务根容器，一级 Module 是按领域划分的工程节点，以下是各工程的模块节点。
每个 Module 通过 module.json.workflows 登记自己的 Workflow，正文位于本模块 workflows/<slug>/workflow.md。
Agent 任务基于明确的 Module，仅使用该模块自身 Workflow，不继承父模块、工程节点或其他模块的流程。
workspace 根不创建共享 Workflow 清单或流程目录。

## 初始内容

项目版本保存在 project.json；team/registry.json、team/people.json、team/skills.json、workspace/registry.json 和 connectors/registry.json 初始均为空清单。
team/skills/ 预留根 Team 的 Skill 正文。领域工程、小组、Agent、模块及流程由团队后续定义，不自动创建示例或导入资源仓库内容。
skills/、workflows/ 及其资料目录不属于组织或模块节点。

运行日志、事务记录、成员任务和会话数据保存在用户目录，不写入此项目知识目录。
`);
      if(await exists(dir))fail('CONFLICT','初始化期间出现 .cbim，请检查后重新打开');await fs.rename(staging,dir);
    }finally{await fs.rm(staging,{recursive:true,force:true})}
  }
  async read():Promise<Snapshot>{const files=await readKnowledge(this.owner.paths,this.owner.entry.path);return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,revision:revision(files),files}}
  /** 读取当前正文并校验；返回结构错误不等于工作区不可用。 */
  async snapshot(){this.owner.assert();const snapshot=await this.read();snapshot.validation=await this.owner.rules.validate(this.owner.entry.path,snapshot.files);this.owner.knowledgeErrors=snapshot.validation.issues.filter(i=>i.severity==='error').length;
    for(const [p,text]of Object.entries(snapshot.validation.indexes)){const old=snapshot.files.find(f=>f.path===p);if(old?.text!==text)snapshot.validation.issues.push({severity:'warning',code:'index_stale',path:p,message:'派生注册表与知识定义不一致，可通过校验并更新索引修复'})}
    if(await exists(path.join(this.owner.entry.path,'.cbim.local')))snapshot.validation.issues.push({severity:'warning',code:'legacy_local',path:'.cbim.local',message:'发现旧本地历史目录。请先备份并核对身份；未授权不会移动或删除。'});return snapshot}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const current=this.queue.then(operation);this.queue=current.catch(()=>{});return current}
  private async draft(request:ChangeRequest):Promise<Preview>{
    if(!plannedRequestSchema.safeParse(request).success)fail('REQUEST_INVALID','知识请求只接受原身份、版本和文件变更；来源证明只能来自私有计划');
    this.owner.assert(request);if(!/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId))fail('REQUEST_ID','请求标识须为 8–100 位字母、数字、下划线或横线');
    const snapshot=await this.read();if(snapshot.revision!==request.revision)fail('CONFLICT','知识已被外部修改，请重新读取并合并');
    const map=new Map(snapshot.files.map(f=>[f.path,f.text]));const seen=new Set<string>();
    for(const change of request.changes){await this.owner.paths.knowledge(this.owner.entry.path,change.path);if(!isKnowledge(change.path)||INDEXES.includes(change.path)||change.path==='.cbim/project.json')fail('TYPE','该路径不是可编辑的正式知识类型，索引与版本由程序维护');if(seen.has(change.path.toLowerCase()))fail('DUPLICATE','一个事务不能重复修改同一文件');seen.add(change.path.toLowerCase());if(change.text!==null&&Buffer.byteLength(change.text)>2*1024*1024)fail('SIZE','单文件不能超过 2 MiB');change.text===null?map.delete(change.path):map.set(change.path,change.text)}
    const projected=[...map].map(([p,text])=>({path:p,text,hash:hash(text)}));const validation=await this.owner.rules.validate(this.owner.entry.path,projected);
    const changes=[...request.changes];if(validation.structural)for(const [p,text]of Object.entries(validation.indexes))if(map.get(p)!==text)changes.push({path:p,text});
    const affected=snapshot.files.filter(f=>request.changes.some(c=>f.text.includes(c.path)||f.text.includes(path.posix.basename(c.path)))).map(f=>f.path);
    const diff=changes.map(c=>`--- ${c.path}\n${snapshot.files.find(f=>f.path===c.path)?.text||'(新建)'}\n+++ ${c.path}\n${c.text??'(删除)'}`).join('\n\n');
    return {request,changes,validation,affected,diff,fingerprint:hash(json(request))};
  }
  /** 只生成差异和校验结果，不写正式知识；提交必须再次核对读取版本。 */
  async preview(request:ChangeRequest){return this.serial(()=>this.draft(request))}
  /** 按串行队列执行版本检查和带日志的写入；同请求内容幂等，失败时只回滚仍匹配本次写入的文件。 */
  async commit(request:ChangeRequest){this.owner.assert(request);return this.serial(async()=>{
    this.owner.assert(request);this.activeOperations++;
    try{return await this.commitInternal(request)}finally{this.activeOperations--}
  })}
  /** 原缓存只提供固定计划；旧计划仅能命中成功 journal，不自动升级旧意图。 */
  async commitPlanned(reference:KnowledgePlanRef){const loaded=await readKnowledgePlan(this.owner,reference);return this.serial(async()=>{
    this.owner.assert();const file=path.join(this.owner.paths.local(this.owner.entry.id,'transactions'),loaded.request.requestId+'.json');
    if(await exists(file)){const status=await this.journalStatus(loaded.request);if(status?.state==='committed'&&status.result)return status.result;fail('RECOVERY','原知识计划尚未核实，不允许重放')}
    if(!loaded.plan)fail('SOURCE_PLAN_INVALID','旧计划缺少来源语义，请重新预览');this.owner.assert(loaded.request);this.activeOperations++;
    try{return await this.commitInternal(loaded.request,undefined,loaded.plan)}finally{this.activeOperations--}
  })}
  /** 调用方已经持有 serial；开始后 close 必须 drain，不能把 closing 当成中途取消提交。 */
  private async commitInternal(request:ChangeRequest,intentId?:string,plan?:PlannedKnowledgeCommit){
    this.owner.assert(request);
      const journalPath=path.join(this.owner.paths.local(this.owner.entry.id,'transactions'),request.requestId+'.json');
      if(await exists(journalPath)){const old=await this.journalStatus(request);if(intentId&&old?.governance?.intentId!==intentId)fail('GOVERNANCE_DATA','原知识事务缺少匹配的治理来源');if(old?.state==='committed'&&old.result)return old.result;fail('RECOVERY','此前请求未提交或已回滚，请重新读取后使用新请求标识')}
      const preview=await this.draft(request);if(!preview.validation.structural)fail('VALIDATION',preview.validation.issues.filter(x=>x.severity==='error').map(x=>`${x.path}: ${x.message}`).join('\n'));
      const current=await this.read();if(current.revision!==request.revision)fail('CONFLICT','校验期间知识已变化');
      const governance=await this.governance?.verify(current,preview,request,value=>this.journalStatus(value),intentId);
      // 新调用仍在入口检查 running。此事务已持有 serial，关闭正在等待它；这里只复核身份，不能因进入 closing 丢弃已受理提交。
      if(request.workspaceId!==this.owner.entry.id||request.instanceId!==this.owner.instanceId)fail('STALE_INSTANCE','知识提交的工程或运行实例身份已变化');
      if(intentId&&!governance)fail('GOVERNANCE_UNAVAILABLE','治理提交缺少可信来源');
      const before:Record<string,string|null>={},after:Record<string,string|null>={};for(const c of preview.changes){before[c.path]=current.files.find(f=>f.path===c.path)?.text??null;after[c.path]=c.text}
      let source:KnowledgeSourceJournal|undefined;
      if(this.sources){
        current.validation=await this.owner.rules.validate(this.owner.entry.path,current.files);
        const projected=new Map(current.files.map(f=>[f.path,f]));for(const [name,text]of Object.entries(after))if(text===null)projected.delete(name);else projected.set(name,{path:name,text,hash:hash(text)});
        const files=[...projected.values()];source=await this.sources.build(request,current,{workspaceId:request.workspaceId,instanceId:request.instanceId,revision:revision(files),files,validation:preview.validation},before,after,plan);
      }
      const journal:Journal={version:1,workspaceId:this.owner.entry.id,requestId:request.requestId,fingerprint:preview.fingerprint,state:'prepared',before,after,...(governance?{governance}:{}),...(source?{source}:{})};
      if(Buffer.byteLength(json(journal))>16*1024*1024)fail('SOURCE_LIMIT','完整知识事务记录超过容量，未写入知识');
      try{await atomic(journalPath,json(journal));if(source)await this.sources!.prepare(source)}catch(error){
        // prepared 保存和 Store 受理都可能结果未知。只有真实原 pending 能提供后续写屏障；否则封闭实例保护 before。
        if(source){let protectedByStore=false;try{await this.sources!.verify(source,true);protectedByStore=true}catch{}
          if(!protectedByStore){this.owner.state='recovery_required';this.owner.error='来源准备结果待核实，请重新打开工作区核实原事务；不会自动重做知识写入'}}throw error;
      }
      const expected=new Map(current.files.map(f=>[f.path,f]));journal.state='committing';await atomic(journalPath,json(journal));
      try{let n=0;for(const [p,text]of Object.entries(after)){
          const live=await this.read();if(live.revision!==revision([...expected.values()]))fail('CONFLICT','提交期间检测到外部修改，正在安全回滚');
          await this.write(p,text);if(text===null)expected.delete(p);else expected.set(p,{path:p,text,hash:hash(text)});this.owner.fault?.(++n);
        }
        const final=await this.read();if(final.revision!==revision([...expected.values()]))fail('CONFLICT','提交末尾出现外部修改');
        const result={state:'committed',workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,requestId:request.requestId,revision:final.revision,changed:Object.keys(after)};
        journal.state='committed';journal.result=result;await atomic(journalPath,json(journal));this.owner.lastRevision=final.revision;this.owner.changed=false;
      }catch(e){
        // committed 写盘可能已接受但确认失败，不能据异常覆盖原成功或开始回滚。
        if(journal.state==='committed')fail('SOURCE_UNKNOWN','知识提交结果未确认，请保留原请求并重新打开核实');
        await this.rollback(journal,journalPath);if(source&&(journal as Journal).state==='rolled_back')await this.sources!.settle(source,'rolled_back',hash(json(journal)));throw e;
      }
      // 原知识成功已固定；来源 final 或通知失败只保留待核实，绝不进入文件回滚。
      if(source)try{await this.sources!.settle(source,'committed',hash(json(journal)),journal.result!.revision)}catch{fail('SOURCE_FINAL_PENDING','知识已提交，来源记录待核实；保留原请求，不能重做写入')}
      await this.log('committed',{requestId:request.requestId,files:Object.keys(after).length});return journal.result!;
  }
  private async write(relative:string,text:string|null){const target=await this.owner.paths.knowledge(this.owner.entry.path,relative);if(text===null)await fs.rm(target,{force:true});else await atomic(target,text)}
  private async rollback(journal:Journal,p:string){let blocked=false;
    for(const name of Object.keys(journal.after).reverse()){const target=await this.owner.paths.knowledge(this.owner.entry.path,name);const live=await exists(target)?await fs.readFile(target,'utf8'):null;if(live===journal.before[name])continue;if(live!==journal.after[name]){blocked=true;continue}try{await this.write(name,journal.before[name])}catch{blocked=true}}
    journal.state=blocked?'recovery_required':'rolled_back';await atomic(p,json(journal));if(blocked){this.owner.state='recovery_required';this.owner.error='恢复遇到外部修改，保留现场与事务证据，请人工合并后重新打开'}
  }
  /** 核实原 journal 后回滚获准但未完成的事务，或补来源结算；未获准 prepared 仅比对 before，冲突保留现场。 */
  async recover(){
    const dir=this.owner.paths.local(this.owner.entry.id,'transactions');await fs.mkdir(dir,{recursive:true});const sourceRecords=new Map((await this.sources?.transitions()??[]).map(item=>[item.requestId,item])),seen=new Set<string>();
    for(const file of await fs.readdir(dir)){
      if(!file.endsWith('.json'))continue;const p=path.join(dir,file),stat=await fs.lstat(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)fail('RECOVERY','知识事务文件无效');
      const journal=await readJson<Journal>(p);if(journal.workspaceId!==this.owner.entry.id)fail('IDENTITY','事务记录属于其他工程');const fileId=file.slice(0,-5);
      if(journal.source||sourceRecords.has(fileId)){
        if(!journal.source||!this.sources||fileId!==journal.requestId)fail('SOURCE_JOURNAL_INVALID','来源屏障缺少匹配的原知识日志');
        await this.journalStatus(journal.source.request);seen.add(fileId);
      }
      if(journal.governance||this.governance?.hasIntent(fileId)){if(!this.governance)fail('GOVERNANCE_UNAVAILABLE','治理日志缺少私有来源');const request=await this.governance.request(fileId);if(request.requestId!==journal.requestId)fail('GOVERNANCE_DATA','治理事务文件名与原意图不一致');await this.journalStatus(request)}
      if(journal.source&&journal.state==='prepared'&&!sourceRecords.has(fileId)){
        // 未建立来源 pending 就从未获准写正式知识。只能证明仍是 before 后结束，绝不把恰等于 after 的外部修改回滚。
        for(const [name,before] of Object.entries(journal.before)){const target=await this.owner.paths.knowledge(this.owner.entry.path,name);const live=await exists(target)?await fs.readFile(target,'utf8'):null;if(live!==before)fail('SOURCE_RECOVERY_REQUIRED','来源准备尚未获准写入，当前文件与原 before 不同；保留现场等待人工核实')}
        journal.state='rolled_back';await atomic(p,json(journal));
      }else if(['prepared','committing','recovery_required'].includes(journal.state)){
        await this.rollback(journal,p);if(journal.state==='recovery_required')fail('RECOVERY','未完成事务与外部修改冲突；请根据本地事务证据人工合并后重新打开');
      }
      if(journal.source&&['committed','rolled_back'].includes(journal.state))await this.sources!.settle(journal.source,journal.state as 'committed'|'rolled_back',hash(json(journal)),journal.result?.revision);
    }
    if([...sourceRecords.keys()].some(id=>!seen.has(id)))fail('SOURCE_JOURNAL_INVALID','来源历史引用的原知识日志缺失，不能解除屏障');
  }
  async planMove(snapshot:Snapshot,from:string,to:string|null):Promise<ChangeRequest>{
    this.owner.assert(snapshot);await this.owner.paths.knowledge(this.owner.entry.path,from);if(to)await this.owner.paths.knowledge(this.owner.entry.path,to);
    const prefix=(p:string)=>p===from||p.startsWith(from+'/');const moved=snapshot.files.filter(f=>prefix(f.path));if(!moved.length)fail('NOT_FOUND','移动或删除对象不存在');
    const changes:Change[]=[];const mapPath=(p:string)=>to&&prefix(p)?to+p.slice(from.length):p;
    for(const f of snapshot.files){const newPath=mapPath(f.path);if(to&&newPath!==f.path&&snapshot.files.some(x=>x.path===newPath))fail('CONFLICT','目标已存在');let text=f.text;
      if(f.path.endsWith('.json')&&!INDEXES.includes(f.path)){
        const owner=path.posix.dirname(f.path),newOwner=path.posix.dirname(newPath);
        const rewrite=(value:any,key=''):any=>{if(typeof value==='string'){
          if(['id','children'].includes(key)&&prefix(value)){if(!to)fail('REFERENCE',`仍被 ${f.path} 引用，请在事务中显式修正引用`);return mapPath(value)}
          if(['overview','reference','work_principles'].includes(key)){const resolved=path.posix.normalize(path.posix.join(owner,value));if(prefix(resolved)&&!to&&!prefix(f.path))fail('REFERENCE',`仍被 ${f.path} 引用`);return path.posix.relative(newOwner,mapPath(resolved))}
          return value}
          if(Array.isArray(value))return value.map(v=>rewrite(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)]));return value};
        if(!prefix(f.path)||to){const d=rewrite(parseJson(text));if(f.path.endsWith('/module.json')&&newPath!==f.path)d.name=path.posix.basename(path.posix.dirname(newPath));text=json(d)}
      }else if(f.path.endsWith('.md')){
        text=text.replace(/\]\(([^)]+)\)/g,(match,link:string)=>{if(/^[a-z]+:/i.test(link)||link.startsWith('#'))return match;const [location,anchor]=link.split('#');const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(f.path),location));if(prefix(resolved)&&!to&&!prefix(f.path))fail('REFERENCE',`仍被 ${f.path} 的 Markdown 链接引用`);const updated=path.posix.relative(path.posix.dirname(newPath),mapPath(resolved));return `](${updated}${anchor?'#'+anchor:''})`});
      }
      if(INDEXES.includes(f.path))continue;if(prefix(f.path)){changes.push({path:f.path,text:null});if(to)changes.push({path:newPath,text})}else if(text!==f.text)changes.push({path:f.path,text});
    }
    return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes};
  }
}
