/**
 * 作用定位：迁移期网页设置的具名通信契约出口。
 * 设计原因：仅保留已有配置 Schema 和公开摘要，不向界面开放网页服务、密钥解析或浏览器。
 */
export {webConfigureInput} from '../../logic/web';
export type {WebSettingsView} from '../../logic/web';
