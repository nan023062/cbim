/**
 * 作用定位：设置中心的分类导航、搜索与独立子页面；业务表单仍通过原 IPC 保存。
 * 设计原因：首次访问才挂载表单，访问后隐藏保留草稿与授权轮询；仓库失败不阻塞模型、外观等其它设置。
 * 生命周期：离开设置中心才卸载全部表单；搜索只筛选入口，不提交或清空当前页面。
 */
import {useEffect,useRef,useState} from 'react';
import {Icon} from '../components/Icon';
import {ModelSettings} from './ModelSettings';
import {EngineSettings} from './EngineSettings';
import {AdmissionSettings} from './AdmissionSettings';
import {BudgetSettings} from './BudgetSettings';
import {WebSettings} from './WebSettings';
import {ResourceSettings} from './ResourceSettings';
import {AccountSettings} from './AccountSettings';
import {AppearanceSettings} from './AppearanceSettings';
import {AboutSettings} from './AboutSettings';
import {findSettingsSections,settingsSections,type SettingsSectionId} from './settings-sections';
import type {AppearanceController} from './useAppearance';
import type {SoftwareUpdateController} from '../updates/useSoftwareUpdates';
import './settings.css';
export interface SettingsViewProps {
  section:SettingsSectionId;
  onSectionChange:(section:SettingsSectionId)=>void;
  onBack:()=>void;
  appearance:AppearanceController;
  updates:SoftwareUpdateController;
  onOpenUpdates:()=>void;
}
/** 导航状态由外壳持有，支持账号菜单和资源页面直达；不重新创建更新或外观控制器。 */
export function SettingsView({section,onSectionChange,onBack,appearance,updates,onOpenUpdates}:SettingsViewProps){
  const [query,setQuery]=useState(''),[visited,setVisited]=useState<SettingsSectionId[]>([section]);
  const content=useRef<HTMLDivElement>(null);
  const found=findSettingsSections(query),active=settingsSections.find(item=>item.id===section)!;
  useEffect(()=>{setVisited(old=>old.includes(section)?old:[...old,section]);content.current?.scrollTo(0,0)},[section]);
  function open(id:SettingsSectionId){onSectionChange(id);setQuery('')}
  function panel(id:SettingsSectionId){switch(id){
    case 'models':return <ModelSettings/>;
    case 'engines':return <EngineSettings active={section==='engines'}/>;
    case 'accounts':return <AccountSettings/>;
    case 'appearance':return <AppearanceSettings appearance={appearance}/>;
    case 'runtime':return <AdmissionSettings active={section==='runtime'}/>;
    case 'budget':return <BudgetSettings/>;
    case 'web':return <WebSettings/>;
    case 'resources':return <ResourceSettings/>;
    case 'about':return <AboutSettings updates={updates} onOpenUpdates={onOpenUpdates}/>;
  }}
  return <div className="settings-center"><div className="settings-layout">
    <aside className="settings-navigation" aria-label="设置导航">
      <div className="settings-nav-heading"><button className="icon-button" aria-label="返回工作空间" onClick={onBack}><Icon name="chevron"/></button><span>设置</span></div>
      <div className="settings-search"><Icon name="search" size={16}/><input type="search" aria-label="搜索设置" placeholder="搜索设置…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" aria-label="清除设置搜索" onClick={()=>setQuery('')}><Icon name="close" size={14}/></button>}</div>
      <label className="settings-mobile-picker">设置分类<select value={section} onChange={e=>open(e.target.value as SettingsSectionId)}>{settingsSections.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <nav className={'settings-nav-list'+(query?' is-searching':'')} aria-label="设置分类">
        {[...new Set(found.map(item=>item.group))].map(group=><div className="settings-nav-group" key={group}><p>{group}</p>{found.filter(item=>item.group===group).map(item=><button key={item.id} aria-current={section===item.id?'page':undefined} aria-controls={'settings-panel-'+item.id} onClick={()=>open(item.id)}><Icon name={item.icon} size={17}/><span>{item.label}</span></button>)}</div>)}
        {query&&<p className="settings-search-count" role="status">{found.length?`找到 ${found.length} 项设置`:'没有匹配的设置，试试“模型”“主题”或“共享”。'}</p>}
      </nav>
      <p className="settings-nav-footnote">CBIM Assistant</p>
    </aside>
    <div className="settings-content" ref={content}><div className="settings-content-inner"><header className="settings-page-heading"><p>{active.group}</p><h1>{active.label}</h1><span>{active.description}</span></header>
      {settingsSections.filter(item=>visited.includes(item.id)||section===item.id).map(item=><section key={item.id} id={'settings-panel-'+item.id} hidden={item.id!==section} aria-label={item.label} className="settings-panel">{panel(item.id)}</section>)}
    </div></div>
  </div></div>;
}
