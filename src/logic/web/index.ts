/**
 * 作用定位：网页工具和设置的纯业务协议入口。
 * 设计原因：调度器和桥接只需参数与结果契约，不加载网络、配置存储或凭据实现。
 */
export {webFetchInput,webSearchInput,webFetchOutput,webSearchOutput,webConfigureInput} from './contracts';
export type {WebSettingsView,WebToolsPort} from './contracts';
