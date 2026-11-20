/** 新视图入口。同步挂载主框架，供桌面宿主确认首页就绪。 */
import { createElement } from 'react';

import { flushSync } from 'react-dom';

import { createRoot } from 'react-dom/client';

import { DesktopShell } from './desktop/DesktopShell';

import './shared/shell.css';

import './desktop/sidebar.css';

import './desktop/workspace-list.css';

import './shared/interface.css';

import { ResourceMonitor } from './monitor/ResourceMonitor';

const root = createRoot(document.getElementById('root')!);

const theme = localStorage.getItem('cbim.desktop.theme');

if (theme === 'light' || theme === 'dark')
  document.documentElement.dataset.theme = theme;

flushSync(() => root.render(createElement(location.hash === '#monitor' ? ResourceMonitor : DesktopShell)));
