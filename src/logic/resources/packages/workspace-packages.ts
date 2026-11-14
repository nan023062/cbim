/**
 * 作用定位：把当前工作区的静态团队/业务架构发布到统一资源仓库，并提供持久化导入预览与显式提交。
 * 设计原因：仓库与目标工程各有独立身份和版本；v2 私有预览固定两端基线、完整请求和替换域，正式写入由固定计划加载器转入知识与来源握手。可变回执缓存不改变计划指纹，也不能代替原 journal 成功证明。
 * 职责边界：共享的是静态定义，不是成员实例、任务图或主会话；远端仅沿用已连接仓库，不宣称已实现账号云服务。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {atomic} from '../../../core/platform/node/files';
import {hash,json} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import {buildWorkspacePackage,parseWorkspacePackage,planWorkspacePackage} from '../../knowledge/rules/portable-package';
import type {KnowledgeWorkspace,KnowledgeCommit} from '../../knowledge/rules/ports';
import type {ChangeRequest} from '../../knowledge/rules/types';
import {knowledgePlanHash,type PackagePlanV2} from '../../knowledge/rules/planned-commit';
import type {PublishWorkspaceResult,ImportWorkspacePreview} from './contracts';
import type {ResourceRepositories} from '../service';

const identity={workspaceId:z.string().min(1).max(200),instanceId:z.string().uuid()};
const version={...identity,revision:z.string().min(1),repositoryId:z.string().uuid(),repositoryRevision:z.string().min(1)};
const publishInput=z.object({...version,kind:z.enum(['team','agent','skill','architecture']),objectId:z.string().min(1).optional(),name:z.string().trim().min(1).max(100),summary:z.string().trim().max(1000)}).strict();
const previewInput=z.object({...version,resourceId:z.string().uuid(),mode:z.enum(['add','replace']).default('add'),targetParentId:z.string().min(1).optional(),slug:z.string().min(1).optional()}).strict();
const commitInput=z.object({...identity,planId:z.string().uuid()}).strict();
interface ImportPlan {version:1|2;request:ChangeRequest;source:{repositoryId:string;repositoryRevision:string;resourceId:string;contentHash:string};createdRoots:string[];deletedRoots:string[];kind?:PackagePlanV2['kind'];mode?:PackagePlanV2['mode'];targetRoot?:string;planHash?:string;fingerprint:string;committed?:KnowledgeCommit;reindexRequest?:ChangeRequest;result?:KnowledgeCommit}
const changeRequest=z.object({...identity,revision:z.string().min(1),requestId:z.string().uuid(),changes:z.array(z.object({path:z.string().min(1),text:z.string().nullable()}).strict())}).strict();
const receipt=z.object({state:z.literal('committed'),...identity,requestId:z.string().uuid(),revision:z.string(),changed:z.array(z.string())}).strict();
const planSchema=z.object({version:z.union([z.literal(1),z.literal(2)]),request:changeRequest,source:z.object({repositoryId:z.string().uuid(),repositoryRevision:z.string().min(1),resourceId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),createdRoots:z.array(z.string()),deletedRoots:z.array(z.string()),kind:z.enum(['team','agent','skill','architecture']).optional(),mode:z.enum(['add','replace']).optional(),targetRoot:z.string().optional(),planHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),committed:receipt.optional(),reindexRequest:changeRequest.optional(),result:receipt.optional()}).strict();
const planFingerprint=(plan:Omit<ImportPlan,'fingerprint'>|ImportPlan)=>{const {fingerprint:_,...body}=plan as ImportPlan;return hash(json(body))};
// IPC 每次创建门面，但同一工作区的多次点击必须共用队列；正式知识仍由原存储串行、版本和事务日志保护。
const commitQueues=new WeakMap<KnowledgeWorkspace,Promise<unknown>>();

/** 每个已打开工作区一个门面；共享 ResourceRepositories 与现有目录，不能由前端直接指定磁盘路径。 */
export class WorkspacePackages {
  constructor(private workspace:KnowledgeWorkspace,private repositories:ResourceRepositories){}
  private async source(repositoryId:string,repositoryRevision:string){
    const snapshot=await this.repositories.read();
    if(snapshot.repositoryId!==repositoryId)fail('REPOSITORY_CHANGED','当前仓库已切换，请重新读取资源');
    if(snapshot.revision!==repositoryRevision)fail('CONFLICT','源仓库已变化，请重新选择资源并预览');
    return snapshot;
  }
  private planPath(id:string){if(!z.string().uuid().safeParse(id).success)fail('PLAN','无效资源导入计划');return path.join(this.workspace.paths.local(this.workspace.entry.id,'cache'),'resource-imports',id+'.json')}
  private async savePlan(plan:ImportPlan){plan.fingerprint=planFingerprint(plan);await atomic(this.planPath(plan.request.requestId),json(plan))}
  private async readPlan(id:string):Promise<ImportPlan>{
    let value:unknown;try{const file=this.planPath(id);if((await fs.lstat(file)).isSymbolicLink())fail('PLAN','资源导入计划不能是符号链接');value=JSON.parse(await fs.readFile(file,'utf8'))}catch{fail('PLAN','资源导入预览不存在或损坏，请重新预览')}
    const parsed=planSchema.safeParse(value);if(!parsed.success)fail('PLAN','资源导入计划格式无效');
    // Schema 只验证，不重排原缓存：现有指纹绑定原 JSON 字段顺序，可变回执也不能替换不可变意图。
    const plan=value as ImportPlan;
    if(plan.request.requestId!==id||planFingerprint(plan)!==plan.fingerprint)fail('PLAN','资源导入计划内容已变化，请重新预览');
    for(const result of [plan.result,plan.committed])if(result&&(result.requestId!==id||result.workspaceId!==plan.request.workspaceId||result.instanceId!==plan.request.instanceId))fail('PLAN','资源导入回执身份不一致');
    if(plan.reindexRequest&&(!plan.committed||plan.reindexRequest.workspaceId!==plan.request.workspaceId||plan.reindexRequest.instanceId!==plan.request.instanceId||plan.reindexRequest.changes.length))fail('PLAN','资源导入索引计划身份不一致');
    return plan;
  }
  /** 用户明确发布后保存到当前本地/已连接服务器仓库；相同静态内容不重复创建资源。 */
  async publish(raw:unknown):Promise<PublishWorkspaceResult>{
    const input=publishInput.parse(raw);this.workspace.assert(input);
    const snapshot=await this.workspace.snapshot();if(snapshot.revision!==input.revision)fail('CONFLICT','源工作区知识已变化，请刷新后发布');
    const built=buildWorkspacePackage(snapshot,input),content=json(built.package),repository=await this.repositories.read();
    if(repository.repositoryId!==input.repositoryId)fail('REPOSITORY_CHANGED','当前仓库已切换，请重新发布');
    // 回执丢失后重新点击同一内容可以找到已经保存的资源；不能按名称覆盖别人的定义。
    const existing=repository.items.find(item=>item.kind===input.kind&&item.name===input.name&&item.summary===input.summary&&item.content===content);
    if(existing)return {repository,resourceId:existing.id,warnings:built.warnings,removedBindings:built.removedBindings};
    if(repository.revision!==input.repositoryRevision)fail('CONFLICT','目标仓库已变化，请刷新后发布');
    if((await this.workspace.read()).revision!==snapshot.revision)fail('CONFLICT','发布期间源知识已变化，请刷新后重试');
    const saved=await this.repositories.save({repositoryId:input.repositoryId,revision:input.repositoryRevision,item:{kind:input.kind,name:input.name,summary:input.summary,content}});
    const resource=saved.items.find(item=>item.kind===input.kind&&item.content===content);if(!resource)fail('RESOURCE_DATA','仓库未返回已保存资源，请刷新核实');
    return {repository:saved,resourceId:resource.id,warnings:built.warnings,removedBindings:built.removedBindings};
  }
  /** 固定源资源及目标基线并持久化计划；仅返回差异，绝不直接应用知识。 */
  async preview(raw:unknown):Promise<ImportWorkspacePreview>{
    const input=previewInput.parse(raw);this.workspace.assert(input);
    const repository=await this.source(input.repositoryId,input.repositoryRevision),resource=repository.items.find(item=>item.id===input.resourceId);
    if(!resource)fail('NOT_FOUND','源资源不存在，请刷新仓库');
    if(!['team','agent','skill','architecture'].includes(resource.kind))fail('RESOURCE_KIND','此资源不支持应用；业务模板必须是完整业务架构包');
    const pack=parseWorkspacePackage(resource.content,resource.kind),snapshot=await this.workspace.snapshot();if(snapshot.revision!==input.revision)fail('CONFLICT','目标知识已变化，请刷新后重新预览');
    const planned=planWorkspacePackage(snapshot,pack,input);
    for(const root of planned.createdRoots)await this.workspace.objects.assertAbsent(root);
    for(const root of planned.deletedRoots)await this.workspace.objects.assertKnowledgeOnly(root,snapshot.files);
    const request:ChangeRequest={workspaceId:input.workspaceId,instanceId:input.instanceId,revision:input.revision,requestId:randomUUID(),changes:planned.changes},preview=await this.workspace.preview(request);
    const immutable={version:2 as const,request,source:{repositoryId:input.repositoryId,repositoryRevision:input.repositoryRevision,resourceId:input.resourceId,contentHash:hash(resource.content)},kind:pack.kind,mode:input.mode,targetRoot:planned.targetRoot,createdRoots:planned.createdRoots,deletedRoots:planned.deletedRoots};
    const body={...immutable,planHash:knowledgePlanHash(immutable)};
    await this.savePlan({...body,fingerprint:planFingerprint(body)});
    const before=new Map(snapshot.files.map(file=>[file.path,file.text]));
    return {...preview,planId:request.requestId,kind:pack.kind,mode:input.mode,targetRoot:planned.targetRoot,files:preview.changes.map(change=>({path:change.path,action:change.text===null?'delete':before.has(change.path)?'update':'create'})),warnings:planned.warnings,removedBindings:planned.removedBindings};
  }
  /**
   * 显式提交才写知识；同时复核源仓库/内容和目标版本，旧实例计划不能复用。
   * 已提交回执优先返回；若在知识提交后、缓存回执前崩溃，目标版本不同只能向知识幂等日志查询原请求，不能发起第二次写入。
   */
  async commit(raw:unknown):Promise<KnowledgeCommit>{
    const queue=commitQueues.get(this.workspace)??Promise.resolve(),current=queue.then(()=>this.commitPlan(raw));commitQueues.set(this.workspace,current.catch(()=>{}));return current;
  }
  private async commitPlan(raw:unknown):Promise<KnowledgeCommit>{
    const input=commitInput.parse(raw);this.workspace.assert(input);const plan=await this.readPlan(input.planId);
    // 原成功证明先于旧实例判断；只读历史不复活旧清理或索引计划，未提交旧计划仍须重新预览。
    const original=await this.workspace.committedReceipt(plan.request);
    if(plan.committed&&!isDeepStrictEqual(original,plan.committed)||plan.result&&!original)fail('SOURCE_PLAN_INVALID','资源计划缓存没有匹配的原知识提交证明');
    if(plan.result){
      let expected=original!;
      if(plan.reindexRequest){const indexed=await this.workspace.committedReceipt(plan.reindexRequest);if(!indexed)fail('SOURCE_PLAN_INVALID','资源计划最终缓存缺少原索引提交证明');expected={...expected,revision:indexed.revision,changed:[...new Set([...expected.changed,...indexed.changed])]}}
      if(!isDeepStrictEqual(expected,plan.result))fail('SOURCE_PLAN_INVALID','资源计划最终回执与原知识日志不一致');return plan.result;
    }
    if(original&&plan.request.instanceId!==this.workspace.instanceId)return original;
    this.workspace.assert(plan.request);
    const current=await this.workspace.read();
    if(!plan.committed&&current.revision===plan.request.revision){
      const repository=await this.source(plan.source.repositoryId,plan.source.repositoryRevision),resource=repository.items.find(item=>item.id===plan.source.resourceId);
      if(!resource||hash(resource.content)!==plan.source.contentHash)fail('CONFLICT','源资源内容已变化，请重新预览');
      for(const root of plan.createdRoots)await this.workspace.objects.assertAbsent(root);
      for(const root of plan.deletedRoots)await this.workspace.objects.assertKnowledgeOnly(root,current.files);
    }
    // 不同目标版本时 commit 仅能命中已提交回执，否则既有知识事务会拒绝过期 revision。
    if(!plan.committed)plan.committed=await this.workspace.commitPlanned({kind:'package_plan',planId:input.planId});
    try{
      await this.savePlan(plan);let result=plan.committed;
      if(plan.deletedRoots.length){
      // 只能 rmdir 空目录，不能删除未知文件；重试可重复执行。旧物理小组清除后，通过知识事务重建派生索引。
      for(const root of plan.deletedRoots)await this.workspace.objects.pruneEmpty(root);
      if(!plan.reindexRequest){const after=await this.workspace.read();plan.reindexRequest={workspaceId:after.workspaceId,instanceId:after.instanceId,revision:after.revision,requestId:randomUUID(),changes:[]};await this.savePlan(plan)}
      try{const indexed=await this.workspace.commit(plan.reindexRequest);result={...result,revision:indexed.revision,changed:[...new Set([...result.changed,...indexed.changed])]}}
      catch(error){
        // 若其他治理事务先提交，本次静态导入已经成功。保留主回执，下一次显式重试只重新规划索引，不能重放包内容。
        if((error as {code?:string}).code==='CONFLICT'){delete plan.reindexRequest;await this.savePlan(plan)}throw error;
      }
      }
      plan.result=result;await this.savePlan(plan);return result;
    }catch(error){
      fail('RESOURCE_IMPORT_APPLIED',`静态定义已应用，目录清理、索引刷新或回执保存尚未完成。请重试同一计划 ${input.planId}；不会重复写入包内容。原因：${error instanceof Error?error.message:String(error)}`);
    }
  }
}
