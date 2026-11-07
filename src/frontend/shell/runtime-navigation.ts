/**
 * 作用定位：把全局运行页的定位目标核对为现有主会话，并只更新本机页签与任务图选择。
 * 设计原因：全局摘要不是启动许可。导航前后复核同一工作区实例，异步结果按请求代次隔离；不通过名称猜会话、不占用未发送草稿页签。
 */
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {GraphSnapshot,ScopeSummary} from '../../bridge/contracts/dispatch';
import type {RuntimeNavigationTarget} from '../runtime/runtime-view-state';
import {newTab,type TabLayout} from './tabs';

/** 只在一次页面定位中使用；消费后丢弃，不持久化为恢复或执行意图。 */
export interface RuntimeNavigationRequest extends RuntimeNavigationTarget {requestId:number;instanceId:string}
/** loop.list 的白名单事实；成员任务只作为目标节点，不能借其 ID 创建主会话。 */
export interface VerifiedRuntimeNavigation {target:RuntimeNavigationTarget;workspace:WorkspaceView;conversation:{taskId:string;goal:string}}
type NavigationReader=(action:'list'|'loop.list',args?:{id:string})=>Promise<unknown>;
type NavigationGraph={identity:GraphSnapshot['identity'];root:Pick<GraphSnapshot['root'],'nodeId'>;tasks:readonly Pick<GraphSnapshot['tasks'][number],'taskId'|'scopeId'>[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

function runningWorkspace(raw:unknown,id:string):WorkspaceView{
  const rows=object(raw)&&Array.isArray(raw.entries)?raw.entries:[];
  const matches=rows.filter(value=>object(value)&&value.id===id);
  if(matches.length!==1||!object(matches[0])||matches[0].state!=='running'||typeof matches[0].instanceId!=='string'||!matches[0].instanceId)throw Error('原工作区当前未就绪，无法定位会话。');
  return matches[0] as unknown as WorkspaceView;
}

/** 只读核实；cancel 或更新请求后，迟到成功和失败都不再影响当前页面。 */
export class RuntimeNavigationResolver {
  private generation=0;
  constructor(private readonly read:NavigationReader){}
  cancel(){this.generation++}
  async resolve(raw:RuntimeNavigationTarget):Promise<VerifiedRuntimeNavigation|undefined>{
    const generation=++this.generation;
    const current=()=>generation===this.generation;
    const target:RuntimeNavigationTarget={workspaceId:raw.workspaceId,rootSessionId:raw.rootSessionId,...(raw.taskId?{taskId:raw.taskId}:{}),...(raw.scopeId?{scopeId:raw.scopeId}:{})};
    try{
      if(!target.workspaceId||!target.rootSessionId)throw Error('运行记录缺少原会话身份，无法定位。');
      const first=await this.read('list');if(!current())return;
      const workspace=runningWorkspace(first,target.workspaceId);
      const records=await this.read('loop.list',{id:target.workspaceId});if(!current())return;
      if(!Array.isArray(records))throw Error('原会话记录无效，请重新核实。');
      const candidates=records.filter(record=>object(record)&&object(record.task)&&record.task.taskId===target.rootSessionId);
      if(!candidates.length)throw Error('找不到可核实的原会话记录，未创建替代会话。');
      for(const record of candidates){
        const task=(record as Record<string,unknown>).task as Record<string,unknown>;
        if(task.workspaceId!==target.workspaceId||task.mode!=='chat'||typeof task.goal!=='string')throw Error('原会话身份与工作区不一致，无法定位。');
      }
      const last=await this.read('list');if(!current())return;
      const latest=runningWorkspace(last,target.workspaceId);
      if(latest.instanceId!==workspace.instanceId)throw Error('工作区实例已变化，请从运行管理重新定位。');
      const task=(candidates[0] as {task:{taskId:string;goal:string}}).task;
      return {target,workspace:latest,conversation:{taskId:task.taskId,goal:task.goal}};
    }catch(error){if(current())throw error;return}
  }
}

/** 只切换已绑定原会话的页签；不存在时新增历史绑定，不修改任何原草稿、附件或其他工作区。 */
export function bindRuntimeConversation(layout:TabLayout|undefined,verified:VerifiedRuntimeNavigation):TabLayout{
  const base=layout??{tabs:[],active:''};
  const existing=base.tabs.find(tab=>tab.kind==='chat'&&tab.taskId===verified.conversation.taskId);
  if(existing)return base.active===existing.id?base:{...base,active:existing.id};
  const tab={...newTab('chat'),taskId:verified.conversation.taskId,title:verified.conversation.goal.split('\n')[0].slice(0,60)||'历史对话'};
  return {tabs:[...base.tabs,tab],active:tab.id};
}

/** 对已同步的原图进行一次定位；不存在的周期或节点明确拒绝，不猜最新周期、不改变执行中的目标。 */
export function runtimeTaskSelection(target:RuntimeNavigationTarget,identity:{workspaceId:string;rootSessionId?:string},graph:NavigationGraph|undefined,scopes:readonly Pick<ScopeSummary,'scopeId'>[]):{taskId:string;scopeId?:string}{
  if(target.workspaceId!==identity.workspaceId||target.rootSessionId!==identity.rootSessionId)throw Error('定位请求不属于当前会话。');
  if(graph&&(graph.identity.workspaceId!==identity.workspaceId||graph.identity.rootSessionId!==identity.rootSessionId))throw Error('原任务图身份不一致，请重新同步。');
  const rootId=graph?.root.nodeId??'session:'+target.rootSessionId;
  const isRoot=!target.taskId||target.taskId===target.rootSessionId||target.taskId===rootId;
  const task=isRoot?undefined:graph?.tasks.find(item=>item.taskId===target.taskId);
  if(!isRoot&&!task)throw Error('原任务节点已不可读取，未选择其他节点。');
  const scopeId=target.scopeId??task?.scopeId;
  if(scopeId&&!scopes.some(scope=>scope.scopeId===scopeId))throw Error('原目标周期已不可读取，未切换为最新目标。');
  if(task&&target.scopeId&&task.scopeId!==target.scopeId)throw Error('任务节点与指定目标周期不一致。');
  return {taskId:isRoot?rootId:task!.taskId,...(scopeId?{scopeId}:{})};
}
