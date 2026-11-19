/** 办公工具的使用模式与任务会话契约。一个连接器实例对应一个可调度资源。 */
import type { ConnectorServer } from './service';

/** 由宿主绑定调用身份，供连接器区分不同 Office 和任务的状态。 */
export interface ConnectorTaskContext
{
  readonly officeId: string;

  readonly workspaceId: string;

  readonly agentInstanceId: string;

  readonly taskId: string;
}

/** 任务持有的工具端口。结束时释放本次占用，释放后拒绝后续调用。 */
export interface ConnectorSession<Descriptor, Result> extends ConnectorServer<Descriptor, Result>
{
  Release(): Promise<void>;
}

/** 从获取到释放，同一资源只允许一个任务占用。取消等待时须撤销本次获取。 */
export abstract class ExclusiveConnector<Descriptor, Result>
{
  public readonly mode = 'exclusive' as const;

  public abstract Acquire(context: ConnectorTaskContext, signal: AbortSignal): Promise<ConnectorSession<Descriptor, Result>>;
}

/** 各任务同时使用同一资源，各自持有独立的状态、输出和释放句柄。 */
export abstract class ConcurrentConnector<Descriptor, Result>
{
  public readonly mode = 'concurrent' as const;

  public abstract OpenSession(context: ConnectorTaskContext, signal: AbortSignal): Promise<ConnectorSession<Descriptor, Result>>;
}

export type Connector<Descriptor, Result> = ExclusiveConnector<Descriptor, Result> | ConcurrentConnector<Descriptor, Result>;
