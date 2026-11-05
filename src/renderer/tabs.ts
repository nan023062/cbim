export const tabKinds = {
  chat: {label:'对话', description:'围绕当前工作区开展协作', icon:'chat'},
  flow: {label:'任务流程', description:'预览当前任务流程实时图', icon:'flow'},
  team: {label:'团队组织架构', description:'预览团队与 AI 成员的能力架构', icon:'team'},
  knowledge: {label:'团队知识图', description:'预览项目模块架构与正式知识', icon:'knowledge'},
} as const;
export type TabKind=keyof typeof tabKinds;
export interface ViewTab {id:string;kind:TabKind;title:string;draft?:string}
export interface TabLayout {tabs:ViewTab[];active:string}
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
      const seen=new Set<string>();const tabs:ViewTab[]=v.tabs.filter((t:any)=>t&&typeof t.id==='string'&&!seen.has(t.id)&&seen.add(t.id)&&Object.hasOwn(tabKinds,t.kind)&&typeof t.title==='string').map((t:any)=>({id:t.id,kind:t.kind,title:t.title.slice(0,60),draft:typeof t.draft==='string'?t.draft:undefined}));
      result[id]={tabs,active:tabs.some(t=>t.id===v.active)?v.active:tabs[0]?.id||''};
    }return result;
  }catch{return {}}
}
