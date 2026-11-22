/**
 * 作用定位：设置页提供分类搜索、通用设置概览和当前桌面的外观选择。
 * 设计原因：分类导航和外观交互留在页面，模型设置交给独立组件，未接入栏目不冒充完整业务能力。
 */
import { useState, type ReactNode } from 'react';

import { Icon } from '../../framework-ui/Icon';

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

function Toggle({ label }: { label: string })
{
  return <input className="preference-switch" type="checkbox" role="switch" disabled aria-label={label} />;
}

export function SettingsView({ initial, onBack }: { initial: string; onBack: () => void })
{
  const [section, setSection] = useState(initial);

  const [query, setQuery] = useState('');

  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');

  const visible = sections.filter(([name]) => name.includes(query.trim()));

  return <main className="preferences">
    <aside aria-label="设置导航">
      <header><button aria-label="返回工作区" onClick={onBack}>←</button><h1>设置</h1></header>
      <label className="preference-search"><Icon name="search" size={15} /><input autoComplete="off" aria-label="搜索设置分类" placeholder="搜索设置" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav>{visible.map(([name, icon]) => <button key={name} aria-current={section === name ? 'page' : undefined} disabled={!['通用', '外观', '帮助', '关于', '模型供应商'].includes(name)} onClick={() => setSection(name)}><Icon name={icon} size={16} />{name}</button>)}</nav>
      {!visible.length && <p role="status">没有匹配的设置分类</p>}
    </aside>
    <div key={section} className="preference-scroll"><div className="preference-content">
      {section === '模型供应商' ? <ModelSettings /> : section === '通用' ? <>
        <div className="preference-profile"><span className="profile-badge">C</span><div><strong>本地用户</strong><small>CBIM · 本地使用</small></div></div>
        <section><h2>语言</h2><Row label="显示语言" hint="应用界面的显示语言"><select aria-label="显示语言" disabled><option>简体中文</option></select></Row></section>
        <section><h2>通知</h2><Row label="系统通知" hint="任务完成、出错或需要回复时提醒"><Toggle label="系统通知" /></Row></section>
        <section><h2>应用行为</h2><Row label="自动启动" hint="登录电脑后打开 CBIM"><Toggle label="自动启动" /></Row>
          <Row label="关闭主窗口时"><span>退出 CBIM</span></Row>
          <Row label="切回时防误触"><Toggle label="切回时防误触" /></Row></section>
        <section><h2>离开电脑时</h2><Row label="保持电脑唤醒" hint="后台任务执行期间保持唤醒"><Toggle label="保持电脑唤醒" /></Row></section>
        <section><h2>消息输入</h2><Row label="使用 Ctrl+Enter 发送"><Toggle label="使用 Ctrl+Enter 发送" /></Row>
          <Row label="运行中发送方式"><select aria-label="运行中发送方式" disabled><option>排队</option><option>插话</option></select></Row></section>
        <section><h2>新任务默认工作目录</h2><Row label="本机默认工作目录" hint="未设置"><button disabled>选择目录</button></Row></section>
      </> : section === '外观' ? <section><h2>外观</h2><Row label="界面主题"><select aria-label="界面主题" value={theme} onChange={e => { const value = e.target.value; localStorage.setItem('cbim.desktop.theme', value); document.documentElement.dataset.theme = value; setTheme(value); }}><option value="dark">深色</option><option value="light">浅色</option></select></Row></section> :
        <section><h2>{section}</h2><div className="preference-row">{section === '帮助' ? '从「新建」选择项目目录，通过「发现」浏览资源。' : 'CBIM Assistant · AI 团队工作空间'}</div></section>}
    </div></div>
  </main>;
}
