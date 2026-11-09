/**
 * 作用定位：页签种类、默认布局、排序与本机布局恢复。
 * 设计原因：布局、草稿、标题与删除标记按工作区隔离保存；轮询不能复活已移除条目，重命名不改原任务目标或运行证据。
 */
import type {ChatAttachment} from '../../bridge/contracts/chat';
export const tabKinds = {
  chat: {label:'对话', description:'围绕当前工作区开展协作', icon:'chat'},
  flow: {label:'任务流程', description:'预览当前任务流程实时图', icon:'flow'},
  team: {label:'团队组织架构', description:'预览团队与 AI 成员的能力架构', icon:'team'},
  knowledge: {label:'团队知识图', description:'预览项目模块架构与正式知识', icon:'knowledge'},
} as const;
export type TabKind=keyof typeof tabKinds;
/** 独立页签身份；draft 只是本机草稿，不代表消息已发送。 */
export interface ViewTab {id:string;kind:TabKind;title:string;customTitle?:boolean;draft?:string;/** 仅绑定本工作区任务，消息正文以主进程日志为准。 */taskId?:string;attachments?:ChatAttachment[]}
/** 有序页签及当前 active ID；关闭最后一个页签时 active 为空。 */
export interface TabLayout {tabs:ViewTab[];active:string;/** 本机移除的任务条目；只抑制列表恢复，不删除后端历史或停止运行。 */hiddenTaskIds?:string[]}
/** 以工作区 ID 为键的本机布局，各工作区草稿与选中页签相互隔离。 */
export type Layouts=Record<string,TabLayout>;
export function newTab(kind:TabKind):ViewTab{return {id:crypto.randomUUID(),kind,title:tabKinds[kind].label}}
export function initialLayout():TabLayout {const t=newTab('chat');return {tabs:[t],active:t.id}}
export function moveTab(layout:TabLayout,from:string,to:string):TabLayout {
  const tabs=[...layout.tabs],a=tabs.findIndex(t=>t.id===from),b=tabs.findIndex(t=>t.id===to);
  if(a<0||b<0||a===b)return layout;tabs.splice(b,0,tabs.splice(a,1)[0]);return {...layout,tabs};
}
export function readLayouts(text:string|null):Layouts {
  try{const value=JSON.parse(text||'{}'),result:Layouts={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
    for(const [id,v] of Object.entries(value) as [string,any][]){if(!/^[a-f0-9]{64}$/.test(id)||!v||!Array.isArray(v.tabs))continue;
      const seen=new Set<string>();const tabs:ViewTab[]=v.tabs.filter((t:any)=>t&&typeof t.id==='string'&&!seen.has(t.id)&&seen.add(t.id)&&Object.hasOwn(tabKinds,t.kind)&&typeof t.title==='string').map((t:any)=>({id:t.id,kind:t.kind,title:t.title.slice(0,60),draft:typeof t.draft==='string'?t.draft:undefined,attachments:Array.isArray(t.attachments)?t.attachments.filter((a:any)=>a&&typeof a.id==='string'&&/^[0-9a-f-]{36}$/.test(a.id)&&['file','folder','link','web','connector'].includes(a.kind)&&typeof a.name==='string'&&typeof a.source==='string').slice(0,12):[],taskId:typeof t.taskId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(t.taskId)?t.taskId:undefined}));
      for(const tab of tabs)if(v.tabs.some((raw:any)=>raw.id===tab.id&&raw.customTitle===true))tab.customTitle=true;
      const hiddenTaskIds=Array.isArray(v.hiddenTaskIds)?[...new Set(v.hiddenTaskIds.filter((item:unknown)=>typeof item==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(item)))] as string[]:[];
      const visible=tabs.filter(tab=>!tab.taskId||!hiddenTaskIds.includes(tab.taskId));
      result[id]={tabs:visible,active:visible.some(t=>t.id===v.active)?v.active:visible[0]?.id||'',...(hiddenTaskIds.length?{hiddenTaskIds}:{})};
    }return result;
  }catch{return {}}
}

/** 将持久化任务补回侧栏；已有草稿、选中项和自定义标题保持不变。 */
export function mergeConversations(layout:TabLayout|undefined,records:{task?:{taskId:string;goal:string;mode?:string}}[]):TabLayout|undefined{
 const tasks=[...new Map(records.filter(r=>r.task?.mode==='chat'&&!layout?.hiddenTaskIds?.includes(r.task.taskId)).map(r=>[r.task!.taskId,r.task!])).values()];
 if(!tasks.length)return layout;
 const base=layout||{tabs:[],active:''};let changed=false;const tabs=[...base.tabs];
 for(const task of tasks){const title=task.goal.split('\n')[0].slice(0,60)||'新对话',index=tabs.findIndex(t=>t.kind==='chat'&&t.taskId===task.taskId);
   if(index<0){tabs.push({...newTab('chat'),title,taskId:task.taskId});changed=true}
   else if(!tabs[index].customTitle&&['对话','新对话'].includes(tabs[index].title)&&tabs[index].title!==title){tabs[index]={...tabs[index],title};changed=true}
 }
 return changed?{...base,tabs,active:base.active||tabs[0].id}:base;
}

/** 本机改名保持任务身份和草稿；空白名称不生效。 */
export function renameConversation(layout:TabLayout,id:string,title:string):TabLayout{
 const name=title.trim().slice(0,60);return name?{...layout,tabs:layout.tabs.map(tab=>tab.id===id?{...tab,title:name,customTitle:true}:tab)}:layout;
}
/** 移除条目并保存任务墓碑；删除当前最后一项时提供新的空对话，不调用执行服务。 */
export function removeConversation(layout:TabLayout,id:string):TabLayout{
 const removed=layout.tabs.find(tab=>tab.id===id);if(!removed)return layout;
 const tabs=layout.tabs.filter(tab=>tab.id!==id&&(!removed.taskId||tab.taskId!==removed.taskId));
 if(!tabs.some(tab=>tab.kind==='chat'))tabs.push(newTab('chat'));
 return {...layout,tabs,active:tabs.some(tab=>tab.id===layout.active)?layout.active:tabs[0].id,...(removed.taskId?{hiddenTaskIds:[...new Set([...(layout.hiddenTaskIds??[]),removed.taskId])]}:{})};
}
