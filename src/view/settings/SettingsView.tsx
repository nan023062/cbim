/**
 * 作用定位：设置页提供分类搜索、通用设置概览和当前桌面的外观选择。
 * 设计原因：分类导航和外观交互留在页面，模型设置交给独立组件，未接入栏目不冒充完整业务能力。
 */
import { ScrollWindow, IconButton, Button, FieldLabel, Icon, Input, Option, Select } from '../../framework-ui';
import { useState, type ReactNode } from 'react';


import './settings.css';

import { ModelSettings } from './ModelSettings';

const sections = [
  ['通用', 'settings'], ['外观', 'palette'], ['个性化', 'sparkles'], ['模型供应商', 'api'],
  ['用量历史', 'history'], ['模型组', 'team'], ['语音输入', 'conversation'], ['IM 机器人', 'chat'],
  ['键盘快捷键', 'code'], ['任务导入', 'folder'], ['远程连接', 'desktop'], ['共享任务', 'team'],
  ['插件', 'plug'], ['工具', 'settings'], ['自动操作', 'flow'], ['存储空间', 'folder'],
  ['帮助', 'info'], ['关于', 'info'],
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode })
{
  return <div className="preference-row"><div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>{children}</div>;
}

export function SettingsView({ initial, onBack, onMarket }: { initial: string; onBack: () => void; onMarket: () => void })
{
  const [section, setSection] = useState(initial);

  const [query, setQuery] = useState('');

  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');

  const visible = sections.filter(([name]) => name.includes(query.trim()));
  const available = ['通用', '外观', '模型供应商', '帮助', '关于'];
  const upcoming = visible.filter(([name]) => !available.includes(name));

  return <main className="preferences">
    <aside {...ScrollWindow.native} aria-label="设置导航">
      <header><IconButton aria-label="返回工作区" onClick={onBack}><Icon name="back" /></IconButton><h1>设置</h1></header>
      <FieldLabel className="preference-search"><Icon name="search" size={15} /><Input autoComplete="off" aria-label="搜索设置分类" placeholder="搜索设置" value={query} onChange={e => setQuery(e.target.value)} /></FieldLabel>
      <nav {...ScrollWindow.native}>{visible.filter(([name])=>available.includes(name)).map(([name, icon]) => <Button key={name} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}><Icon name={icon} size={16} />{name}</Button>)}</nav>
      {!!upcoming.length && <details key={query.trim()} open={query.trim() ? true : undefined}><summary>未开放栏目（{upcoming.length}）</summary><p>{upcoming.map(([name])=>name).join('、')}</p></details>}
      {!visible.length && <p role="status">没有匹配的设置分类</p>}
    </aside>
    <ScrollWindow key={section} className="preference-scroll"><div className="preference-content">
      {section === '模型供应商' ? <ModelSettings /> : section === '通用' ? <>
        <div className="preference-profile"><span className="profile-badge">C</span><div><strong>本地用户</strong><small>CBIM · 本地使用</small></div></div>
        <section><h2>当前设置</h2><Row label="显示语言"><span>简体中文</span></Row><Row label="关闭主窗口时"><span>退出 CBIM</span></Row></section>
        <section><h2>尚未开放的设置</h2><p>系统通知、自动启动、切回防误触、保持唤醒、输入快捷键和默认工作目录暂不支持自定义。</p></section>
      </> : section === '外观' ? <section><h2>外观</h2><Row label="界面主题"><Select aria-label="界面主题" value={theme} onChange={e => { const value = e.target.value; localStorage.setItem('cbim.desktop.theme', value); document.documentElement.dataset.theme = value; setTheme(value); }}><Option value="dark">深色</Option><Option value="light">浅色</Option></Select></Row></section> :
        <section><h2>{section}</h2><div className="preference-row">{section === '帮助' ? <><span>选择项目目录后，可在资源商城浏览可用资源。</span><Button onClick={onMarket}>打开资源商城</Button></> : 'CBIM Assistant · AI 团队工作空间'}</div></section>}
    </div></ScrollWindow>
  </main>;
}
