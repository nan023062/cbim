/**
 * 作用定位：为业务 Application 增加类型化 IPC 分发入口。
 * 设计原因：唯一业务生命周期仍在 Logic；此适配器仅补充通信方法，不覆盖或复制状态与关闭行为。
 * 实现形式：实例适配类，继承同一业务 Application；重载签名与实现保持连续。
 */
import { Application as ApplicationRuntime } from '../../logic/application/application';

import type { ApplicationServices } from './ipc/services';

import type { IpcAction, IpcResponse } from '../contracts/ipc-call';

import { dispatchApplication } from './ipc/dispatch';

/** 可替换业务实例的桥接适配，仅将消息委托给独立路由。 */
export class Application extends ApplicationRuntime implements ApplicationServices
{
  /** 已知操作返回配对的响应类型；请求仍交由路由进行运行时解析。 */
  public Dispatch<A extends IpcAction>(action: A, args?: unknown): Promise<IpcResponse<A>>;

  /** 动态操作名只能取得 unknown，不能绕过解析取得未经核实的响应类型。 */
  public Dispatch(action: string, args?: unknown): Promise<unknown>;

  /** 将当前业务实例交给独立路由；不另建服务状态，不吞掉原解析或业务错误。 */
  public Dispatch(action: string, args: unknown = {})
  {
    return dispatchApplication(this, action, args);
  }
}
