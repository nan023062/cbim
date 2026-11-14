/**
 * 作用定位：业务/团队架构的显式一键治理入口，使用主 Agent 已保存的引擎模型启动真实会话。
 * 设计原因：共用现有执行和权限路径，按钮不是占位提示或后台定时任务；回包未知时保留状态并提示从历史核实，不自动再发。
 */
import {useRef,useState} from 'react';
export type GovernanceKind='business'|'team';
export const governanceWorkflow=(kind:GovernanceKind)=>({title:kind==='business'?'业务架构治理':'团队架构治理',tool:kind==='business'?'cbim_skill_business_architecture_governance':'cbim_skill_team_architecture_governance'});
export function GovernanceLaunch({workspaceId,kind,disabled,onStarted}:{workspaceId:string;kind:GovernanceKind;disabled?:boolean;onStarted?:(taskId:string,title:string)=>void}){
 const gate=useRef(false),[state,setState]=useState<'ready'|'starting'|'started'|'unknown'>('ready'),[message,setMessage]=useState('');
 async function start(){if(gate.current||disabled)return;gate.current=true;setState('starting');const workflow=governanceWorkflow(kind);try{
  const result=await window.cbim.call('loop.chat',{id:workspaceId,message:`请立即执行「${workflow.title}」工作流。先调用 ${workflow.tool} 读取流程，再核对当前工作区的真实知识与代码，在当前权限内完成有证据的治理和验证。`,attachments:[],options:{permission:'ask',collaborationMode:'team'}});
  if(!result||typeof result.taskId!=='string')throw Error('启动回执缺少会话标识');setState('started');setMessage('已启动治理会话');onStarted?.(result.taskId,workflow.title);
 }catch(cause){setState('unknown');setMessage(`启动结果未确认：${cause instanceof Error?cause.message:String(cause)}。请在对话历史核实，避免重复启动。`)}}
 return <div className="governance-launch"><button disabled={disabled||state!=='ready'} onClick={()=>void start()}>{state==='starting'?'正在启动…':state==='started'?'已启动治理':'一键治理'}</button>{message&&<small role={state==='unknown'?'alert':'status'}>{message}</small>}</div>;
}
