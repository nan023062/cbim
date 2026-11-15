/**
 * 作用定位：业务/团队架构的显式治理启动控制器及结果提示。
 * 设计原因：入口移入根菜单，状态留在页面；保留同一次启动门禁和未知回执，不因关闭菜单重复执行。
 */
import {useEffect,useRef,useState} from 'react';
export type GovernanceKind='business'|'team';
export const governanceWorkflow=(kind:GovernanceKind)=>({title:kind==='business'?'业务架构治理':'团队架构治理',tool:kind==='business'?'cbim_skill_business_architecture_governance':'cbim_skill_team_architecture_governance'});
/** 只接受明确点击；工作区切换作废迟到 UI 响应，不取消或重放已发出的治理任务。 */
export function useGovernanceLaunch({workspaceId,kind,disabled,onStarted}:{workspaceId:string;kind:GovernanceKind;disabled?:boolean;onStarted?:(taskId:string,title:string)=>void}){
 const epoch=useRef(0),gate=useRef(false),[state,setState]=useState<'ready'|'starting'|'started'|'unknown'>('ready'),[message,setMessage]=useState('');
 useEffect(()=>{epoch.current++;gate.current=false;setState('ready');setMessage('');return()=>{epoch.current++}},[workspaceId,kind]);
 async function start(){if(gate.current||disabled)return;gate.current=true;const generation=epoch.current;setState('starting');const workflow=governanceWorkflow(kind);try{
  const result=await window.cbim.call('loop.chat',{id:workspaceId,message:`请立即执行「${workflow.title}」工作流。先调用 ${workflow.tool} 读取流程，再核对当前工作区的真实知识与代码，在当前权限内完成有证据的治理和验证。`,attachments:[],options:{permission:'ask',collaborationMode:'team'}});
  if(generation!==epoch.current)return;
  if(!result||typeof result.taskId!=='string')throw Error('启动回执缺少会话标识');setState('started');setMessage('已启动治理会话');onStarted?.(result.taskId,workflow.title);
 }catch(cause){if(generation!==epoch.current)return;setState('unknown');setMessage(`启动结果未确认：${cause instanceof Error?cause.message:String(cause)}。请在对话历史核实，避免重复启动。`)}}
 return {start,disabled:disabled||state!=='ready',state,message,label:state==='starting'?'正在启动…':state==='started'?'已启动治理':'一键治理'};
}
export function GovernanceStatus({launch}:{launch:ReturnType<typeof useGovernanceLaunch>}){
 return launch.message?<p role={launch.state==='unknown'?'alert':'status'}>{launch.message}</p>:null;
}
export function GovernanceLaunch(props:Parameters<typeof useGovernanceLaunch>[0]){
 const launch=useGovernanceLaunch(props);
 return <div className="governance-launch"><button disabled={launch.disabled} onClick={()=>void launch.start()}>{launch.label}</button><GovernanceStatus launch={launch}/></div>;
}
