/**
 * 作用定位：Node 文件基础能力的公开入口，供存储适配使用。
 * 设计原因：目录策略、权限授予与业务事务属于调用者；此独立 Node 入口只提供单文件 I/O，不认识工作区或业务。
 */
export {exists,atomic,readJson} from './text-files';
