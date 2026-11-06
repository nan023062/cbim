/**
 * 作用定位：页签种类、默认布局、排序与本机布局恢复。
 * 设计原因：布局、草稿、附件身份与对话任务绑定按工作区隔离保存，恢复时过滤无效记录，排序不改变服务目标。
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
export interface ViewTab {id:string;kind:TabKind;title:string;draft?:string;/** 仅绑定本工作区任务，消息正文以主进程日志为准。 */taskId?:string;attachments?:ChatAttachment[]}
/** 有序页签及当前 active ID；关闭最后一个页签时 active 为空。 */
export interface TabLayout {tabs:ViewTab[];active:string}
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
      result[id]={tabs,active:tabs.some(t=>t.id===v.active)?v.active:tabs[0]?.id||''};
    }return result;
  }catch{return {}}
}

/** 将持久化任务补回侧栏；已有草稿、选中项和自定义标题保持不变。 */
export function mergeConversations(layout:TabLayout|undefined,records:{task?:{taskId:string;goal:string;mode?:string}}[]):TabLayout|undefined{
 const tasks=[...new Map(records.filter(r=>r.task?.mode==='chat').map(r=>[r.task!.taskId,r.task!])).values()];
 if(!tasks.length)return layout;
 const base=layout||{tabs:[],active:''};let changed=false;const tabs=[...base.tabs];
 for(const task of tasks){const title=task.goal.split('\n')[0].slice(0,60)||'新对话',index=tabs.findIndex(t=>t.kind==='chat'&&t.taskId===task.taskId);
   if(index<0){tabs.push({...newTab('chat'),title,taskId:task.taskId});changed=true}
   else if(['对话','新对话'].includes(tabs[index].title)&&tabs[index].title!==title){tabs[index]={...tabs[index],title};changed=true}
 }
 return changed?{tabs,active:base.active||tabs[0].id}:base;
}
