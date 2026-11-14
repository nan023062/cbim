/**
 * 作用定位：把当前办公室已提交任务投影为唯一人物、模块工位及派发/汇报动态。
 * 设计原因：长期 TeamSession 才是人物，执行实例不是分身；动画只消费可靠事实，不能改变领取、退出或验收。旧图、跨办公室和重开不会重演历史。
 */
import type {GraphSnapshot,TeamSession,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {teamConversations} from '../execution-view/team-conversations';
import {taskHistoryView} from './task-history-state';

export interface OfficeActor {id:string;sessionId?:string;agentId:string;name:string;main:boolean;state:string;working:boolean;deskId:string;scopeId?:string;taskId?:string;goal:string;queued:number}
export interface OfficeDesk {id:string;name:string}
export interface OfficeSceneState {actors:OfficeActor[];desks:OfficeDesk[];current:TaskNode[];history:TaskNode[]}
/** 当前和历史仅决定可见任务；角色保留，已完成话题不会删除其子对话。 */
export function officeScene(graph:GraphSnapshot,sessions:readonly TeamSession[]|undefined,scopes:readonly ScopeSummary[],mainRunning:boolean):OfficeSceneState{
  const archived=taskHistoryView(graph,scopes),current=graph.tasks.filter(task=>!archived.taskIds.has(task.taskId));
  const open=scopes.find(scope=>scope.status!=='closed'),desks:OfficeDesk[]=[{id:'main',name:'主 Agent 工位'}],deskNames=new Map<string,string>();
  for(const task of current)for(const module of task.modules)deskNames.set(module.moduleId,module.name);
  for(const [id,name] of deskNames)desks.push({id:'module:'+id,name});
  const main=graph.root.agent;
  const paused=open?.status==='waiting',pausing=open?.interruption?.phase==='requested';
  const actors:OfficeActor[]=[{id:'main:'+graph.identity.rootSessionId,agentId:main.agentId,name:main.name,main:true,state:pausing?'正在暂停':paused?'等待补充':mainRunning?'执行 / 协调中':open?'等待成员反馈':'空闲',working:mainRunning&&!paused,deskId:'main',scopeId:open?.scopeId,goal:open?.objective??open?.inputPreview??'等待新任务',queued:0}];
  for(const member of teamConversations(sessions,graph)){
    const tasks=current.filter(task=>task.assignee.agentId===member.session.agentId);
    const working=tasks.find(task=>task.activeRunId||task.status==='running');
    const next=tasks.find(task=>['queued','waiting','planned'].includes(task.status)),task=working??next??tasks.at(-1);
    const inOpen=task?.scopeId===open?.scopeId;
    const state=inOpen&&pausing?'正在暂停':inOpen&&paused?'已暂停':working?'正在作业':next?'等待调度':tasks.some(task=>task.status==='result_ready')?'候选待审阅':tasks.some(task=>['blocked','failed','interrupted'].includes(task.status))?'需要协调':tasks.some(task=>task.status==='checkpointed')?'已停泊':'空闲';
    // 工位键与模块原 ID 分域，合法的 main / lounge 模块不会覆盖办公室固定区域。
    const deskId=task?.modules[0]?'module:'+task.modules[0].moduleId:'lounge';
    actors.push({id:member.session.sessionId,sessionId:member.session.sessionId,agentId:member.session.agentId,name:member.name,main:false,state,working:!!working&&!(inOpen&&paused),deskId,...(task?{taskId:task.taskId,scopeId:task.scopeId}:{}),goal:task?.goal??'等待主 Agent 安排',queued:tasks.filter(value=>value!==working&&['queued','waiting','planned'].includes(value.status)).length});
  }
  if(actors.some(actor=>actor.deskId==='lounge'))desks.push({id:'lounge',name:'协作休息区'});
  return {actors,desks,current,history:archived.tasks};
}
export interface OfficeEvent {id:string;kind:'assignment'|'feedback';agentId:string;taskId:string;scopeId?:string;label:string}
function facts(graph:GraphSnapshot):OfficeEvent[]{
  return graph.tasks.flatMap(task=>{
    const common={agentId:task.assignee.agentId,taskId:task.taskId,scopeId:task.scopeId};
    const events:OfficeEvent[]=[{...common,id:'assignment:'+task.taskId,kind:'assignment',label:'派发任务'}];
    if(task.result)events.push({...common,id:'result:'+task.result.resultId,kind:'feedback',label:'汇报候选'});
    if(task.help)events.push({...common,id:'help:'+task.help.helpId,kind:'feedback',label:'请求协助'});
    for(const checkpoint of task.checkpoints??[])events.push({...common,id:'checkpoint:'+checkpoint.checkpointId,kind:'feedback',label:'汇报检查点'});
    return events;
  });
}
/** 首次快照是静态基线；只播放本次可见期间的新增事实，返回全部新事件供界面摘要，动画可有界合并。 */
export class OfficeEventTracker {
  private key?:string;private seq=-1;private known=new Set<string>();
  observe(graph:GraphSnapshot,visible=true):OfficeEvent[]{
    const key=JSON.stringify([graph.identity.workspaceId,graph.identity.rootSessionId,graph.cursor.streamId]);
    if(key===this.key&&graph.cursor.seq<=this.seq)return [];
    const entries=facts(graph),newOffice=key!==this.key;
    const result=newOffice||!visible?[]:entries.filter(event=>!this.known.has(event.id));
    this.key=key;this.seq=graph.cursor.seq;this.known=new Set(entries.map(event=>event.id));return result;
  }
}
