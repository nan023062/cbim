/**
 * 作用定位：为业务 Application 增加类型化 IPC 分发入口。
 * 设计原因：唯一业务生命周期仍在 Logic；此适配器仅补充通信方法，不覆盖或复制状态与关闭行为。
 */
import {Application as ApplicationRuntime} from '../../logic/application/application';
import type {ApplicationServices} from './ipc/services';
import type {IpcAction,IpcResponse} from '../contracts/ipc-call';
import {dispatchApplication} from './ipc/dispatch';
/** 可替换业务实例的桥接适配，仅将消息委托给独立路由。 */
export class Application extends ApplicationRuntime implements ApplicationServices {
  dispatch<A extends IpcAction>(action:A,args?:unknown):Promise<IpcResponse<A>>;
  dispatch(action:string,args?:unknown):Promise<unknown>;
  dispatch(action:string,args:unknown={}){return dispatchApplication(this,action,args)}
}
