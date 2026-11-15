/**
 * 作用定位：同一页面内的可访问视图切换，统一图标、选中语义与键盘导航。
 * 设计原因：只管理 tab 焦点；业务选择、面板挂载和草稿生命周期由调用方持有，不触发保存或网络操作。
 */
import {Icon} from './Icon';
export interface ViewTab {id:string;label:string;icon:string;count?:number}
/** 调用方用 `${id}-panel-${value}` 和 `${id}-tab-${value}` 关联对应 panel。 */
export function ViewTabs({id,label,value,tabs,onChange}:{id:string;label:string;value:string;tabs:readonly ViewTab[];onChange:(value:string)=>void}){
  return <div className="view-tabs" role="tablist" aria-label={label}>{tabs.map((tab,index)=><button key={tab.id} id={`${id}-tab-${tab.id}`} role="tab" aria-selected={value===tab.id} aria-controls={`${id}-panel-${tab.id}`} tabIndex={value===tab.id?0:-1} onClick={()=>onChange(tab.id)} onKeyDown={event=>{
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:-1;
    if(next<0)return;event.preventDefault();onChange(tabs[next].id);document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }}><Icon name={tab.icon} size={16}/>{tab.label}{tab.count!==undefined&&<span className="view-tab-count">{tab.count}</span>}</button>)}</div>;
}
