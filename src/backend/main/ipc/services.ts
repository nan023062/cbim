/**
 * 作用定位：定义 IPC 路由需要的执行审批、静态角色履历、岗位与模块责任、全局监管、配额、桌面资源导入、模块治理和工作区生命周期入口。
 * 设计原因：路由依赖此契约，Application 负责实现和装配，避免路由反向引用应用类形成类型循环。
 * 职责边界：这里只声明内部调用能力，不代表渲染进程可以直接访问这些服务。
 */
import type {Catalog} from '../workspace/catalog';
import type {Workspace} from '../workspace/workspace';
import type {Paths} from '../platform/paths';
import type {LlmProfiles} from '../persistence/settings/llm-profiles';
import type {ResourceRepositories} from '../resources/resource-repository';
import type {RepositoryConnections} from '../resources/repository-connections';
import type {ModuleGovernanceService} from '../governance/module-governance';
import type {WorkspaceExecutionManager} from '../../scheduler-engine/execution/execution-manager';
import type {WorkspaceDispatchService} from '../../scheduler-engine/execution/dispatch-service';
import type {MemberExecutionManager} from '../../scheduler-engine/execution/member-execution';
import type {AgentHistoryService} from '../../scheduler-engine/runtime/agent-history';
import type {RuntimeCursor,RuntimeRead,RuntimeSnapshot} from '../../core/runtime/types';
import type {Catalog as CatalogData, WorkspaceView} from '../../../bridge/contracts/workspace';
import type {AdmissionSettings} from '../persistence/settings/admission-settings';
import type {BudgetSettings} from '../persistence/settings/budget-settings';
import type {WorkspaceMembers} from '../workspace/workspace-members';
import type {ModuleOwnerships} from '../workspace/module-ownerships';
import type {ChatMaterialImports} from '../persistence/tasks/chat-material-imports';
import type {AdmissionCursor,AdmissionRead} from '../../core/runtime/admission';

/** 应用向路由提供的内部服务；工作区调用始终携带身份，生命周期仍由应用实现管理。 */
export interface ApplicationServices {
  readonly catalog: Catalog;
  readonly paths: Paths;
  readonly models: LlmProfiles;
  readonly resources: ResourceRepositories;
  /** 桌面显式登记、授权和真实只读核验；没有模型入口或任意 URL/凭据参数。 */
  readonly repositoryConnections:RepositoryConnections;
  /** 仅桌面显式导入及取消；不授予仓库权限，不启动执行。 */
  readonly chatMaterials:ChatMaterialImports;
  /** 真正执行准入独立于监管索引；只暴露游标读取和可靠设置，不把领取能力交给页面。 */
  readonly admission:{read(cursor?:AdmissionCursor):AdmissionRead};
  readonly admissionSettings:AdmissionSettings;
  /** 应用设置只为未来周期提供默认策略，不修改当前周期的冻结额度或发放启动许可。 */
  readonly budgetSettings:BudgetSettings;
  /** 应用级活动和用量投影；只读路由不向渲染进程暴露写入事实或接管任务的能力。 */
  readonly runtime:{snapshot():RuntimeSnapshot;read(cursor?:RuntimeCursor):RuntimeRead;rename(workspaceId:string,name:string):void};
  /** 仅观察已运行实例；路由重命名时同步实例显示名，不负责增删实例。 */
  readonly running: ReadonlyMap<string, Workspace>;
  readonly isStopping: boolean;
  list(): Promise<Omit<CatalogData, 'entries'> & {warning: string; entries: WorkspaceView[]}>;
  workspace(id: string): Workspace;
  /** 仅桌面明确治理请求；批准不由模型构造，应用与记录决定是两个独立动作。 */
  governance(id:string):ModuleGovernanceService;
  /** 稳定岗位登记独立于执行实例；只读公开配置，无模型调用或派发副作用。 */
  workspaceMembers(id:string):WorkspaceMembers;
  /** 桌面责任写入只注入本机提交来源，和主工具共用同一服务及持久化裁决。 */
  workspaceOwnerships(id:string):ModuleOwnerships;
  execution(id: string): WorkspaceExecutionManager;
  /** 取得已装配的工作区成员图及人工决定服务；未就绪则拒绝，人工记录不隐式启动大脑或改变权限。 */
  memberDispatch(id:string):WorkspaceDispatchService;
  /** 只接收已派发任务的可信执行命令，成员会话与模型快照由后端绑定。 */
  memberExecution(id:string):MemberExecutionManager;
  /** 按静态角色读取持久 Session 履历；已释放实例和已删除定义仍可追溯，不启动或恢复执行。 */
  agentHistory(id:string):AgentHistoryService;
  /** 合并并发打开；restart 要先停止旧执行实例再重建工作区。 */
  open(id: string, restart?: boolean): Promise<Workspace>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** 保留现有动态模型选项协议；模型身份解析和附件能力验证由应用负责。 */
  modelOptions(input?: any): Promise<any>;
  chatOptions(id: string, input: any, attachments: unknown): Promise<any>;
}
