/**
 * 作用定位：前端视图层的渲染进程入口，仅挂载 App 并加载外壳样式；通过 bridge 与本机后端通信。
 * 设计原因：让进程启动与页面状态分离，最后加载统一界面令牌和控件规则，业务样式保留各页面布局。
 */
import {createRoot} from 'react-dom/client';
import {App} from './shell/App';
import './styles';
createRoot(document.getElementById('root')!).render(<App/>);
