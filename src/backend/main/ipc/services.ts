/**
 * 作用定位：定义 IPC 路由需要的应用服务、成员派发查询、全局运行只读投影及工作区生命周期入口。
 * 设计原因：路由依赖此契约，Application 负责实现和装配，避免路由反向引用应用类形成类型循环。
 * 职责边界：这里只声明内部调用能力，不代表渲染进程可以直接访问这些服务。
 */
import type {Catalog} from '../workspace/catalog';
import type {Workspace} from '../workspace/workspace';
import type {Paths} from '../platform/paths';
import type {LlmProfiles} from '../persistence/settings/llm-profiles';
import type {ResourceRepositories} from '../resources/resource-repository';
import type {WorkspaceExecutionManager} from '../../scheduler-engine/execution/execution-manager';
import type {WorkspaceDispatchService} from '../../scheduler-engine/execution/dispatch-service';
import type {RuntimeCursor,RuntimeRead,RuntimeSnapshot} from '../../core/runtime/types';
import type {Catalog as CatalogData, WorkspaceView} from '../../../bridge/contracts/workspace';

/** 应用向路由提供的内部服务；工作区调用始终携带身份，生命周期仍由应用实现管理。 */
export interface ApplicationServices {
  readonly catalog: Catalog;
  readonly paths: Paths;
  readonly models: LlmProfiles;
  readonly resources: ResourceRepositories;
  /** 应用级活动和用量投影；只读路由不向渲染进程暴露写入事实或接管任务的能力。 */
  readonly runtime:{snapshot():RuntimeSnapshot;read(cursor?:RuntimeCursor):RuntimeRead;rename(workspaceId:string,name:string):void};
  /** 仅观察已运行实例；路由重命名时同步实例显示名，不负责增删实例。 */
  readonly running: ReadonlyMap<string, Workspace>;
  readonly isStopping: boolean;
  list(): Promise<Omit<CatalogData, 'entries'> & {warning: string; entries: WorkspaceView[]}>;
  workspace(id: string): Workspace;
  execution(id: string): WorkspaceExecutionManager;
  /** 仅装配当前工作区成员图服务；不会启动大脑或切换知识写权限。 */
  memberDispatch(id:string):WorkspaceDispatchService;
  /** 合并并发打开；restart 要先停止旧执行实例再重建工作区。 */
  open(id: string, restart?: boolean): Promise<Workspace>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** 保留现有动态模型选项协议；模型身份解析和附件能力验证由应用负责。 */
  modelOptions(input?: any): Promise<any>;
  chatOptions(id: string, input: any, attachments: unknown): Promise<any>;
}
