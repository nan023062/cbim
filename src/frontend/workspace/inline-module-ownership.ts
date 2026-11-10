/**
 * 作用定位：模块卡片一级 Agent 选择的操作编排，复用岗位与责任的严格预览、提交和持久原命令。
 * 设计原因：静态 Agent 不能冒充 memberId；无岗位时按已选默认模型登记，已有岗位不改模型或采纳。两步分别有回执，部分成功不回滚或静默重放。
 * 生命周期：每次写入前检查原视图仍有效；未知结果只查询，重开不自动完成剩余绑定，不包含执行或模型启动端口。
 * 新登记优先采用静态 Agent 的明确选型，失效引用直接拒绝；只有未设置时使用 Pi 和本机默认模型；供应商不决定执行引擎。
 */
import type {ModuleOwnershipIdentity,ModuleOwnershipPage,ModuleOwnershipView} from '../../bridge/contracts/module-ownership';
import type {WorkspaceMemberList,WorkspaceMemberPreviewInput} from '../../bridge/contracts/workspace-members';
import {engineSupportsApi,type LlmSettings,type AgentModelSelection} from '../../bridge/contracts/models';
import {checkedWorkspaceMemberList,checkedWorkspaceMemberPreview,type WorkspaceMemberCommands} from '../team/workspace-member-state';
import {checkedModuleOwnershipPage,checkedModuleOwnershipDetail,checkedModuleOwnershipPreview,type ModuleOwnershipCommands} from './module-ownership-state';

export type InlineOwnerCall=(action:'models.list'|'workspace.members.list'|'workspace.members.preview'|'workspace.members.commit'|'workspace.members.receipt'|'workspace.ownerships.list'|'workspace.ownerships.get'|'workspace.ownerships.preview'|'workspace.ownerships.commit'|'workspace.ownerships.receipt',args?:unknown)=>Promise<any>;
export interface InlineOwnerAgent {id:string;name:string;runtime?:AgentModelSelection}
export interface InlineOwnerChoice {value:string;label:string;disabled?:boolean}
export interface InlineOwnerData {members:WorkspaceMemberList['items'];views:ModuleOwnershipView[]}

/** 固定分页游标，只读取真实岗位；来源错误不能假报为可新建的空列表。 */
export async function readInlineMembers(identity:ModuleOwnershipIdentity,call:InlineOwnerCall){
  const members:WorkspaceMemberList['items']=[];let offset=0,cursor:WorkspaceMemberList['registryCursor']|undefined;
  for(;;){const input={...identity,offset,limit:100,...(offset&&cursor?{expectedRegistryCursor:cursor}:{})};const page=checkedWorkspaceMemberList(await call('workspace.members.list',input),input);members.push(...page.items);if(page.nextOffset===undefined)return members;if(page.nextOffset<=offset||members.length>256)throw Error('岗位列表超出范围或分页未前进');cursor=page.registryCursor;offset=page.nextOffset}
}
/** 责任与岗位各自校验读取版本；保存时重新读取原模块与岗位，不以页面列表作为写入依据。 */
export async function readInlineOwners(identity:ModuleOwnershipIdentity,call:InlineOwnerCall):Promise<InlineOwnerData>{
  const members=await readInlineMembers(identity,call),views:ModuleOwnershipView[]=[];let offset=0,basis:ModuleOwnershipPage['basis']|undefined;
  for(;;){const input={...identity,offset,limit:100,...(basis?{expectedReadBasis:basis}:{})};const page=checkedModuleOwnershipPage(await call('workspace.ownerships.list',input),input);views.push(...page.items);if(page.nextOffset===undefined)return {members,views};if(page.nextOffset<=offset||views.length>4096)throw Error('模块列表超出范围或分页未前进');basis=page.basis;offset=page.nextOffset}
}
/** 只提供自定义 Agent；同一 Agent 多个岗位时在同级列表区分，不能静默替换其中某个岗位的配置。 */
export function inlineOwnerChoices(agents:InlineOwnerAgent[],members:WorkspaceMemberList['items']):InlineOwnerChoice[]{
  return agents.filter(agent=>agent.id!=='cbim:main'&&agent.id!=='cbim:executor').flatMap(agent=>{
    const matches=members.filter(member=>member.agentId===agent.id);
    if(!matches.length)return [{value:'agent:'+agent.id,label:agent.name}];
    return matches.map(member=>({value:'member:'+member.memberId,label:agent.name+(matches.length>1?' · '+member.name:'')+(member.state==='active'?'':member.state==='suspended'?'（已停用）':'（已退休）'),disabled:member.state!=='active'}));
  });
}
export interface InlineOwnerPorts {call:InlineOwnerCall;members:WorkspaceMemberCommands;ownerships:ModuleOwnershipCommands;isCurrent:()=>boolean}
/** 选择即授权本次登记/绑定，不启动业务。任何未知、来源变化或页面离开都停止后续步骤；已受理的前一步仍保留。 */
export async function assignInlineOwner(identity:ModuleOwnershipIdentity,moduleId:string,value:string,agents:InlineOwnerAgent[],ports:InlineOwnerPorts){
  const current=()=>{if(!ports.isCurrent())throw Error('已离开原模块视图，已保存的操作保留；请重新读取后选择。');if(ports.members.blocked||ports.ownerships.blocked)throw Error('存在未核实的原操作，请先查询保存结果。')};
  current();const request={...identity,moduleId};const detail=checkedModuleOwnershipDetail(await ports.call('workspace.ownerships.get',request),request);
  const previous=detail.view.binding;let members=await readInlineMembers(identity,ports.call),member=members.find(item=>'member:'+item.memberId===value);current();
  if(value.startsWith('agent:')){
    const agent=agents.find(item=>'agent:'+item.id===value&&item.id!=='cbim:main'&&item.id!=='cbim:executor');if(!agent)throw Error('所选 Agent 已不存在，请刷新列表。');
    const matches=members.filter(item=>item.agentId===agent.id);
    if(matches.length>1)throw Error('该 Agent 已有多个项目岗位，请刷新后在一级列表中明确选择。');
    if(matches.length)member=matches[0];
    else{
      const models:LlmSettings=await ports.call('models.list'),profile=models.profiles.find(item=>item.id===(agent.runtime?.profileId??models.selectedId)),model=profile?.models.find(item=>item.id===(agent.runtime?.modelId??profile.defaultModel)&&item.enabled);
      if(agent.runtime&&(!profile||!engineSupportsApi(agent.runtime.engine,profile.api)||!model))throw Error('Agent 配置的引擎或模型不可用，请先编辑该 Agent 的选型。');
      if(!profile||!model)throw Error('尚未配置默认模型，请先在模型设置中选择默认模型，再选择负责人。');
      const input:WorkspaceMemberPreviewInput={...identity,change:{kind:'register',agentId:agent.id,name:agent.name.slice(0,100),position:'承担所选 Agent 在本项目的模块责任',adaptation:{instructions:'',references:[]},runtimePolicy:{engine:agent.runtime?.engine??'pi',profileId:profile.id,modelId:model.id},reason:'用户在模块卡片直接选择 Agent：'+agent.name}};
      const preview=checkedWorkspaceMemberPreview(await ports.call('workspace.members.preview',input),input);current();
      const record=await ports.members.submit(input,preview);
      if(record?.phase!=='accepted')throw Error('岗位登记尚未确认，负责人未保存。'+(record?.error??ports.members.snapshot.error));
      current();members=await readInlineMembers(identity,ports.call);member=members.find(item=>item.memberId===record.receipt!.memberId);
      if(!member)throw Error('岗位已保存，但暂时无法读取；请刷新后继续选择负责人。');
    }
  }
  if(value&&(!member||member.state!=='active'||!agents.some(agent=>agent.id===member!.agentId&&agent.id!=='cbim:main')))throw Error('所选 Agent 或岗位当前不可用，请刷新后重新选择。');
  if((previous?.ownerMemberId??null)===(member?.memberId??null))return;
  const input={...identity,change:{moduleId,expectedBinding:previous?{bindingId:previous.bindingId,revision:previous.revision,ownerMemberId:previous.ownerMemberId}:null,nextOwner:member?{memberId:member.memberId,expectedRevision:member.revision}:null,reason:member?'用户在模块卡片选择负责人：'+member.name:'用户在模块卡片恢复主 Agent 默认执行'}};
  const preview=checkedModuleOwnershipPreview(await ports.call('workspace.ownerships.preview',input),input);current();
  const record=await ports.ownerships.submit(input,preview);
  if(record?.phase!=='accepted')throw Error('负责人保存尚未确认，请核实原操作。'+(record?.error??ports.ownerships.snapshot.error));
}
