/**
 * 作用定位：网页服务与配置的宿主装配入口。
 * 设计原因：将有副作用的搜索、页面读取和凭据配置与纯工具协议隔离；浏览器由宿主显式注入。
 */
export {WebService} from './web-service';
export {WebSettings} from './web-settings';
