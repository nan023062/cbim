/**
 * 未指定自定义岗位时发现主 Agent 默认责任；独立派发仅接受自定义岗位，不为失效自定义配置降级，原命令查询保持一致。
 * 作用定位：在既有知识、模型和派发存储之间核实岗位执行绑定，为计划、派发、领取和依赖维护提供同一入口。
 * 设计原因：当前登记与真实能力/模型必须同时匹配；知识锁在外，模型短锁其次，Store 事务最后，不能在事务中反向读取排队服务。
 * 职责边界：只查询或核实，不采纳配置、不修改责任、不运行模型；历史结算不调用当前岗位门禁。配置读取沿岗位采纳引擎，同一模型多引擎按完整配置哈希区分。
 */
import {implicitProjectModuleId,type AutomaticExecutionBinding,type CollaborationPolicy} from '../../core/team/automatic-execution';
import {isDeepStrictEqual} from 'node:util';
import {fail,Fault} from '../../core/foundation/errors';
import type {KnowledgeWorkspace,SourceSnapshotReader} from '../../core/knowledge/ports';
import type {Snapshot} from '../../core/knowledge/types';
import type {DispatchState,DispatchStore} from '../../core/tasks/dispatch-storage';
import type {TaskNode} from '../../core/tasks/graph-types';
import {workspaceMemberEngine,type WorkspaceMemberModelRef,type WorkspaceMemberModelSnapshot} from '../../core/team/workspace-member';
import {workspaceMemberCapabilityHash,workspaceMemberModelHash} from '../../core/team/workspace-member-rules';
import {ownerExecutionSelectionFor,type OwnerExecutionBinding,type OwnerExecutionSelection} from '../../core/team/member-execution-binding';
import {resolveOwnerExecutionSelection,assertCurrentOwnerExecutionBinding} from '../../core/team/member-execution-rules';
import {ownerExecutionDiscoverySchema,taskOwnerInspectInputSchema,type OwnerExecutionDiscovery,type TaskOwnerInspectOutput} from '../../core/team/owner-execution-discovery';
import {resolveDispatchAgent,resolveDispatchModules} from '../context/dispatch-context';

export type OwnerExecutionWorkspace=Pick<KnowledgeWorkspace,'entry'|'instanceId'|'assert'|'snapshot'|'read'|'rules'>&Partial<SourceSnapshotReader>;
/** 公开模型配置端口不含解密、网络或默认选型；短锁回调不得反向取得知识锁。 */
export interface OwnerExecutionModelPorts {
  configuration(profileId:string,modelId:string,engine?:WorkspaceMemberModelRef['engine']):Promise<WorkspaceMemberModelSnapshot>;
  withConfigurations<T>(refs:readonly WorkspaceMemberModelRef[],use:(profiles:readonly WorkspaceMemberModelSnapshot[])=>Promise<T>):Promise<T>;
}
export type ExecutionSelection=OwnerExecutionSelection|{automaticScopeId:string};
export interface OwnerExecutionContext {snapshot:Snapshot;profiles:readonly WorkspaceMemberModelSnapshot[]}
export class OwnerExecutionService {
  constructor(private readonly owner:OwnerExecutionWorkspace,private readonly store:DispatchStore,private readonly models?:OwnerExecutionModelPorts){}
  /** 任何新来源或生命周期核验前只查原命令；回执不授权重做准备或启动。 */
  async replay<T>(command:{commandId:string;fingerprint:string}):Promise<{receipt:T}|undefined>{
    const old=await this.store.commandReceipt(command.commandId);if(!old)return;
    if(old.fingerprint!==command.fingerprint)fail('COMMAND_ID_CONFLICT','相同命令 ID 已用于不同请求');return {receipt:old.receipt as T};
  }
  /** 同一知识串行快照先读 hint，后续事务必须重新核 hint 的全部版本，不把 hint 当许可。 */
  withSnapshot<T>(use:(snapshot:Snapshot,hint:DispatchState)=>Promise<T>,alive:()=>void=()=>{}):Promise<T>{
    if(!this.owner.withSourceSnapshot)fail('OWNER_EXECUTION_UNAVAILABLE','未装配受控岗位执行知识端口');
    return this.owner.withSourceSnapshot(async snapshot=>{this.owner.assert();alive();const hint=await this.store.read();alive();return use(snapshot,hint)});
  }
  /** 多岗位一次持模型锁；只有调用方随后进入 Store 事务，不能从事务内调用本方法。 */
  withContext<T>(select:(hint:DispatchState)=>readonly ExecutionSelection[],use:(context:OwnerExecutionContext)=>Promise<T>,alive:()=>void=()=>{}):Promise<T>{
    if(!this.models)fail('OWNER_EXECUTION_UNAVAILABLE','未装配岗位模型配置端口');
    return this.withSnapshot(async(snapshot,hint)=>{
      const selections=select(hint),refs=selections.map(selection=>{
        if('automaticScopeId' in selection){const policy=hint.scopes?.find(scope=>scope.scopeId===selection.automaticScopeId)?.executionPolicy;if(policy?.mode!=='auto')fail('OWNER_SELECTION_REQUIRED','团队模式需要人工确认模块及负责岗位');return policy.model}
        const member=hint.workspaceMembers?.find(item=>item.memberId===selection.memberId);if(!member)fail('OWNER_MEMBER_UNAVAILABLE','负责岗位不存在');
        return {profileId:member.runtimePolicy.profileId,modelId:member.runtimePolicy.modelId,engine:workspaceMemberEngine(member.runtimePolicy)};
      });
      return this.models!.withConfigurations(refs,async profiles=>{alive();return use({snapshot,profiles})});
    },alive);
  }
  /** 在最终 Store state 核登记、来源、同快照能力与实际模型；不读取或取得其它串行域。 */
  async resolve(state:DispatchState,context:OwnerExecutionContext,selection:OwnerExecutionSelection,moduleIds:readonly string[],agentId?:string):Promise<OwnerExecutionBinding>{
    const binding=resolveOwnerExecutionSelection(state,selection,moduleIds);
    if(agentId!==undefined&&binding.capability.agentId!==agentId)fail('OWNER_AGENT_MISMATCH','派发角色必须与负责岗位实际采纳的能力一致');
    if(context.snapshot.workspaceId!==state.workspaceId)fail('OWNER_IDENTITY','岗位执行知识不属于当前工作区');
    const agent=await resolveDispatchAgent(context.snapshot,binding.capability.agentId);
    if(workspaceMemberCapabilityHash(agent)!==binding.capability.capabilityHash)fail('OWNER_CAPABILITY_CHANGED','负责岗位的原则或有效 Skill 已变化，请明确采纳后重新规划');
    const profile=context.profiles.find(item=>item.id===binding.model.profileId&&item.model===binding.model.modelId&&workspaceMemberModelHash(item)===binding.model.configurationHash);
    if(!profile||workspaceMemberModelHash(profile)!==binding.model.configurationHash)fail('OWNER_MODEL_CHANGED','负责岗位模型配置已变化，请明确采纳后重新规划');
    await resolveDispatchModules(context.snapshot,[...moduleIds]);return binding;
  }
  /** 可信首轮使用明确模型配置冻结 auto；旧入口不传模式时保持团队规则。 */
  async policy(options:{collaborationMode?:'auto'|'team';profileId?:string;model:string;engine?:WorkspaceMemberModelRef['engine']}):Promise<CollaborationPolicy>{
    options={...options};
    if(options.collaborationMode!=='auto')return {mode:'team'};
    if(!options.profileId||!this.models)fail('AUTO_MODEL_REQUIRED','自动模式需要明确可用的对话模型');
    const profile=await this.models.configuration(options.profileId,options.model,options.engine);
    return {mode:'auto',model:{profileId:options.profileId,modelId:options.model,configurationHash:workspaceMemberModelHash(profile),...(options.engine===undefined?{}:{engine:options.engine})}};
  }
  /** 模型不能指定自动模式；缺岗位选择只可引用已保存的可信周期。 */
  selection(state:DispatchState,scopeId:string,selection?:OwnerExecutionSelection):ExecutionSelection{
    if(selection)return selection;
    return fail('MAIN_EXECUTION_REQUIRED','未指定自定义负责 Agent 时，请由主 Agent 在当前会话直接执行；独立派发需要真实 ownerSelection');
  }
  /** 新任务只绑定自定义岗位；旧兜底数据可读但不再授予启动或恢复许可。 */
  async resolveExecution(state:DispatchState,context:OwnerExecutionContext,scopeId:string,selection:OwnerExecutionSelection|undefined,moduleIds:readonly string[],agentId:string):Promise<{ownerBinding?:OwnerExecutionBinding;fallbackBinding?:AutomaticExecutionBinding}>{
    if(selection)return {ownerBinding:await this.resolve(state,context,selection,moduleIds,agentId)};
    return fail('MAIN_EXECUTION_REQUIRED','内置默认执行 Agent 已退役；未指定自定义 Agent 的模块由主 Agent 在当前会话执行，不创建成员任务');
  }
  async verifyTask(state:DispatchState,context:OwnerExecutionContext,task:TaskNode):Promise<OwnerExecutionBinding|AutomaticExecutionBinding>{
    if(task.fallbackBinding){
      if(task.ownerBinding)fail('AUTO_BINDING_INVALID','自动执行不能兼有登记岗位');
      const current=await this.resolveExecution(state,context,task.scopeId!,undefined,task.modules.map(m=>m.moduleId),task.assignee.agentId);
      if(!isDeepStrictEqual(current.fallbackBinding,task.fallbackBinding))fail('AUTO_BINDING_STALE','自动执行的原知识、范围或能力已经变化，请重新规划');
      return current.fallbackBinding!;
    }
    if(!task.ownerBinding)fail('OWNER_BINDING_REQUIRED','旧任务未绑定负责岗位，请重新规划派发；原任务和历史保持不变');
    const ids=task.modules.map(module=>module.moduleId);assertCurrentOwnerExecutionBinding(state,task.ownerBinding,ids);
    const current=await this.resolve(state,context,ownerExecutionSelectionFor(task.ownerBinding),ids,task.assignee.agentId);
    if(!isDeepStrictEqual(current,task.ownerBinding))fail('OWNER_BINDING_STALE','原任务岗位绑定已变化，不能刷新旧任务后继续领取');return current;
  }
  selections(tasks:readonly TaskNode[]):ExecutionSelection[]{return tasks.map(task=>{if(task.fallbackBinding)return {automaticScopeId:task.fallbackBinding.scopeId};if(!task.ownerBinding)fail('OWNER_BINDING_REQUIRED','旧任务未绑定负责岗位，请重新规划派发');return ownerExecutionSelectionFor(task.ownerBinding)})}
  async recheck(snapshot:Snapshot,alive:()=>void=()=>{}){this.owner.assert();alive();const current=await this.owner.read();if(current.revision!==snapshot.revision)fail('OWNER_KNOWLEDGE_CHANGED','准备期间知识发生变化，请重新查询');alive()}
  /** 一次发现各组当前可核实的模块、岗位/来源、能力、模型缺口；前提缺失明确待核实，不冒称通过或回退默认模型。相同错误码合并，不回显配置或秘密。 */
  async discover(moduleIds:readonly string[]):Promise<OwnerExecutionDiscovery>{
    if(!moduleIds.length||moduleIds.length>50||new Set(moduleIds).size!==moduleIds.length)fail('OWNER_MODULES_INVALID','请明确选择不重复的模块');
    return this.withSnapshot(async(snapshot,state)=>{
      const groups:OwnerExecutionDiscovery['groups']=[];
      for(const moduleId of moduleIds){const owner=state.moduleOwnerships?.find(item=>item.moduleId===moduleId),member=state.workspaceMembers?.find(item=>item.memberId===owner?.ownerMemberId);
        const main=!owner?.ownerMemberId||member?.adoption.configuration.agentId==='cbim:executor';
        let group=main?groups.find(item=>item.execution==='main'):groups.find(item=>item.memberId===owner!.ownerMemberId);
        if(!group){group={moduleIds:[],execution:main?'main':'member',...(main?{agentId:'cbim:main'}:{memberId:owner!.ownerMemberId!,...(member?{memberName:member.name,agentId:member.adoption.configuration.agentId}:{})}),issues:[]};groups.push(group)}group.moduleIds.push(moduleId);
      }
      for(const group of groups){
        // 独立核实可观察门禁，避免模型/能力失败遮住模块问题；最终选择仍走原完整 resolve，不由诊断授予许可。
        const add=(code:string,message:string)=>{if(!group.issues.some(issue=>issue.code===code))group.issues.push({code,message})};
        const check=async(action:()=>unknown)=>{try{await action()}catch(error){add(error instanceof Fault?error.code:'OWNER_CONFIGURATION_UNAVAILABLE',error instanceof Fault?error.message:'当前岗位配置暂时无法核实，请检查知识与模型设置')}};
        // 未指派是合法的默认关系，旧内置执行者也不再创建新实例；损坏的自定义绑定仍报告真实缺口。
        if(group.execution==='main'){
          for(const moduleId of group.moduleIds)if(moduleId!==implicitProjectModuleId)await check(()=>resolveDispatchModules(snapshot,[moduleId]));
          continue;
        }
        const member=state.workspaceMembers?.find(item=>item.memberId===group.memberId);
        if(!member){
          add('OWNER_UNASSIGNED','模块尚未设置有效的负责岗位。请在业务架构中设置负责人；有现成岗位时直接选择。');
          if(!state.workspaceMembers?.some(item=>item.state==='active'))add('OWNER_MEMBER_REQUIRED','尚无启用岗位。请在桌面“团队架构 → 项目岗位 → 登记项目岗位”选择能力和岗位模型后登记。当前工具不提供岗位创建。');
          add('OWNER_MODEL_UNRESOLVED','尚无负责岗位，无法核实本组能力和模型；选定岗位后核对已采纳配置，不会回退主会话模型。');
        }
        for(const moduleId of group.moduleIds)await check(()=>resolveDispatchModules(snapshot,[moduleId]));
        if(!member)continue;
        const selection:OwnerExecutionSelection={version:1,memberId:member.memberId,expectedMemberRevision:member.revision,expectedCapabilityHash:member.adoption.capabilityHash,expectedConfigurationHash:member.runtimePolicy.configurationHash,expectedOwners:group.moduleIds.map(moduleId=>{const owner=state.moduleOwnerships!.find(item=>item.moduleId===moduleId)!;return {moduleId,bindingId:owner.bindingId,revision:owner.revision,ownerMemberId:member.memberId}})};
        await check(()=>resolveOwnerExecutionSelection(state,selection,group.moduleIds));
        await check(async()=>{const agent=await resolveDispatchAgent(snapshot,member.adoption.configuration.agentId);if(workspaceMemberCapabilityHash(agent)!==member.adoption.capabilityHash)fail('OWNER_CAPABILITY_CHANGED','负责岗位的原则或有效 Skill 已变化，请在项目岗位明确采纳后重新规划')});
        let profile:WorkspaceMemberModelSnapshot|undefined;
        await check(async()=>{if(!this.models)fail('OWNER_EXECUTION_UNAVAILABLE','未装配岗位模型配置端口');profile=await this.models.configuration(member.runtimePolicy.profileId,member.runtimePolicy.modelId,workspaceMemberEngine(member.runtimePolicy));if(workspaceMemberModelHash(profile)!==member.runtimePolicy.configurationHash)fail('OWNER_MODEL_CHANGED','负责岗位模型配置已变化，请在项目岗位明确采纳当前模型配置后重新规划')});
        if(!group.issues.length&&profile)await check(async()=>{await this.resolve(state,{snapshot,profiles:[profile!]},selection,group.moduleIds,group.agentId);group.selection=selection});
      }
      await this.recheck(snapshot);const latest=await this.store.read();
      if(!isDeepStrictEqual([state.registryCursor,state.ownershipCursor,state.sourceCursor],[latest.registryCursor,latest.ownershipCursor,latest.sourceCursor]))fail('OWNER_READ_STALE','岗位、责任或来源在查询期间变化，请重新查询');
      return ownerExecutionDiscoverySchema.parse({workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,readOnly:true,checkedAt:new Date().toISOString(),knowledgeRevision:snapshot.revision,registryCursor:state.registryCursor??null,ownershipCursor:state.ownershipCursor??null,sourceCursor:state.sourceCursor??null,moduleIds:[...moduleIds],groups});
    });
  }
  /** 以原任务绑定为比较基准；当前观察不覆盖历史，也不授予领取许可。 */
  async inspectTask(raw:unknown):Promise<TaskOwnerInspectOutput>{
    const input=taskOwnerInspectInputSchema.parse(raw);this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('OWNER_IDENTITY','任务不属于当前工作区');
    const find=(state:DispatchState)=>state.graphs.find(graph=>graph.identity.rootSessionId===input.rootSessionId)?.tasks.find(task=>task.taskId===input.taskId);
    const task=find(await this.store.read());if(!task)fail('TASK_NOT_FOUND','原任务不存在');const fixed=structuredClone(task),current=await this.discover(task.modules.map(module=>module.moduleId));
    const latest=find(await this.store.read());if(!latest||latest.revision!==fixed.revision||!isDeepStrictEqual(latest.ownerBinding,fixed.ownerBinding))fail('OWNER_READ_STALE','原任务在查询期间已变化，请刷新后重查');
    return {identity:{workspaceId:input.workspaceId,rootSessionId:input.rootSessionId},taskId:fixed.taskId,taskRevision:fixed.revision,...(fixed.ownerBinding?{ownerBinding:fixed.ownerBinding}:{}),current};
  }
}
