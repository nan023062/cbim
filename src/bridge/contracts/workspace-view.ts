/**
 * 作用定位：转接工作区业务公开数据。
 * 设计原因：业务不依赖 IPC，界面只经桥接契约读取纯类型。
 */
export type {WorkspaceEntry,Catalog,WorkspaceView} from '../../logic/workspace/contracts';
