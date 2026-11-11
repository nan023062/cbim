/**
 * 作用定位：业务架构共享一次岗位/责任读取，每张模块卡片只呈现一级选择器。
 * 设计原因：将列表、真实提交与错误集中在工作区视图；选择只调用既有岗位/责任命令，切换或重开不续做未完成绑定，未决操作可原地核实。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ModuleOwnershipIdentity} from '../../bridge/contracts/module-ownership';
import {workspaceMemberCommands} from '../team/workspace-member-state';
import {moduleOwnershipCommands} from './module-ownership-state';
import {assignInlineOwner,inlineOwnerChoices,readInlineOwners,type InlineOwnerAgent,type InlineOwnerData,type InlineOwnerCall} from './inline-module-ownership';
import {Icon} from '../components/Icon';

/** 一张架构视图共享控制器；知识版本或实例切换使旧异步后续失效，已发送写入仍由原命令追踪。 */
export function useInlineModuleOwners(identity:ModuleOwnershipIdentity|undefined,agents:InlineOwnerAgent[],revision?:string){
  const [data,setData]=useState<InlineOwnerData>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[,tick]=useState(0);
  const epoch=useRef(0),lock=useRef(false);
  const controllers=useMemo(()=>identity?{
    members:workspaceMemberCommands.get(identity.workspaceId,{storage:window.localStorage,uuid:()=>crypto.randomUUID(),commit:input=>window.cbim.call('workspace.members.commit',input),lookup:input=>window.cbim.call('workspace.members.receipt',input)}),
    ownerships:moduleOwnershipCommands.get(identity.workspaceId,{storage:window.localStorage,uuid:()=>crypto.randomUUID(),commit:input=>window.cbim.call('workspace.ownerships.commit',input),lookup:input=>window.cbim.call('workspace.ownerships.receipt',input)}),
  }:undefined,[identity?.workspaceId]);
  const call:InlineOwnerCall=(action,args)=>action==='models.list'?window.cbim.call(action):window.cbim.call(action,args);
  async function load(token:number){if(!identity)return;try{const value=await readInlineOwners(identity,call);if(epoch.current===token)setData(value)}catch(cause){if(epoch.current===token){setData(undefined);setError(String(cause))}}}
  useEffect(()=>{
    const token=++epoch.current;setData(undefined);setError('');setMessage('');
    if(!controllers||!identity)return;
    const notify=()=>tick(value=>value+1),off=[controllers.members.subscribe(notify),controllers.ownerships.subscribe(notify)];
    setLoading(true);void (async()=>{await controllers.members.restore();await controllers.ownerships.restore();if(epoch.current===token)await load(token)})().finally(()=>{if(epoch.current===token)setLoading(false)});
    return()=>{epoch.current++;off.forEach(unsubscribe=>unsubscribe())};
  },[controllers,identity?.instanceId,revision]);
  async function choose(moduleId:string,value:string){
    if(!identity||!controllers||lock.current)return;const token=epoch.current;lock.current=true;setLoading(true);setError('');setMessage('');
    try{await assignInlineOwner(identity,moduleId,value,agents,{...controllers,call,isCurrent:()=>token===epoch.current});if(token===epoch.current)setMessage('负责人已保存。')}
    catch(cause){if(token===epoch.current)setError(String(cause))}
    finally{lock.current=false;if(token===epoch.current){await load(token);setLoading(false)}}
  }
  async function refresh(){if(lock.current||!controllers)return;const token=epoch.current;lock.current=true;setLoading(true);setError('');try{await controllers.members.restore();await controllers.ownerships.restore();await load(token)}finally{lock.current=false;if(token===epoch.current)setLoading(false)}}
  const blocked=!!controllers&&(controllers.members.blocked||controllers.ownerships.blocked);
  return {data,choices:inlineOwnerChoices(agents,data?.members??[]),disabled:!data||loading||blocked,loading,blocked,error:error||controllers?.members.snapshot.error||controllers?.ownerships.snapshot.error,message,choose,refresh};
}
export type InlineModuleOwners=ReturnType<typeof useInlineModuleOwners>;
/** 未显式配置时展示自动解析：父级、模型匹配与主 Agent 兜底；提交中不乐观切换，旧内置岗位也按自动解析展示，其他历史缺失岗位仍显示原身份且可明确解除。 */
export function InlineModuleOwner({moduleId,name,owners}:{moduleId:string;name:string;owners:InlineModuleOwners}){
  const view=owners.data?.views.find(item=>item.moduleId===moduleId),value=view?.binding?.ownerMemberId&&view.owner?.agentId!=='cbim:executor'?'member:'+view.binding.ownerMemberId:'';
  return <label className="module-owner-inline"><Icon name="team" size={15}/><select aria-label={name+' 负责人'} value={value} disabled={owners.disabled} title="未显式设置时，先继承最近父级负责人，再由主模型匹配团队岗位，无匹配时由主 Agent 执行。选择自定义 Agent 会保存显式分工。" onChange={event=>void owners.choose(moduleId,event.target.value)}>
    <option value="">{owners.loading?'正在读取负责人…':'自动解析（未显式设置）'}</option>
    {value&&!owners.choices.some(option=>option.value===value)&&<option value={value} disabled>{view?.owner?.name??'原负责人'}（当前不可用）</option>}
    {owners.choices.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select></label>;
}
