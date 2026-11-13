/**
 * 作用定位：前端视图层的渲染进程入口，仅挂载 App 并加载外壳样式；通过 bridge 与本机后端通信。
 * 设计原因：让进程启动与页面状态分离，保留知识工具样式先于外壳样式的加载关系。
 */
import {createRoot} from 'react-dom/client';
import {App} from './shell/App';
import './shell/shell.css';
createRoot(document.getElementById('root')!).render(<App/>);
