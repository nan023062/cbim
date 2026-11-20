import { openProjectOffice } from '../project';

/**
 * 作用定位：Logic 层的业务应用入口，持有应用级服务和按工作区装配的唯一服务实例。
 * 设计原因：集中管理打开、退役、排空和关闭顺序；通信适配留在 Bridge，业务服务不反向读取本类。
 * 实现形式：有状态实例类；运行集合、准入代际和退出 Promise 均属于当前 Application。
 * 资源边界：密钥适配、文件传输及受管引擎端口只由可信宿主注入，不接受对话参数替换。
 * 生命周期：先撤销等待与新触发，再排空执行和文件操作，最后关闭共享存储、历史与工作区锁；未知结果不自动重放。
 * 初始化：字段初值只含独立容器、标记及监管/准入对象，无跨字段读取；构造体内的服务装配顺序保持原样。
 */
import path from 'node:path';

import { WebSettings } from '../web/service';

import { WebService } from '../web/service';

import type { BrowserReader } from '../../core/web/node';

import { WorkspaceAutomations } from '../automation/service/service';

import type { ControlledFileTransport } from '../file-operations/platform/files/controlled-file-protocol';

import type { ModelRequestBudgetService } from '../budget/runtime/model-request-budget-service';

import type { ControlledFiles } from '../file-operations/service/controlled-files';

import type { IsolatedExecutions } from '../file-operations/service/isolated-executions';

import { LlmProfiles, type SecretCipher } from '../models/service';

import { EngineModelProfiles } from '../engines/service';

import { MainAgentSettings } from '../team/settings/main-agent-settings';

import { AdmissionSettings } from '../runtime/settings/admission-settings';

import { BudgetSettings } from '../budget/settings/budget-settings';

import { GitHubFeedback } from '../feedback/service';

import type { RuntimeMonitor } from '../../framework/monitor';

import type { CbimRuntime } from '../../framework/cbim-runtime';

import { createExecutionManager } from './assembly/execution';

import { EnginePackages } from '../engines/packages';

import type { EngineArtifactsPort } from '../updates/engine-artifacts';

import type { EngineRuntimeResolver } from '../execution/rules/engine-runtime';

import { createMemberServices } from './assembly/member-dispatch';

import { FileDispatchStore } from '../dispatch/storage/dispatch-store';

import type { WorkspaceDispatchService } from '../dispatch/runtime/dispatch-service';

import type { MemberExecutionManager } from '../team/runtime/member-execution';

import { WorkspaceExecutionLease } from '../execution/admission/workspace-lease';

import { AutoCollaboration } from '../dispatch/runtime/auto-collaboration';

import { GlobalRuntimeManager } from '../runtime/monitoring/global-runtime';

import { GlobalRunAdmission } from '../execution/admission/run-admission';

import type { WorkspaceAdmission } from './assembly/execution-admission';

import { WorkspaceRuntimeMonitor } from './assembly/runtime-monitor';

import { ChatInputs } from '../materials/service/chat-inputs';

import { ChatMaterialImports } from '../materials/service/chat-material-imports';

import { createAgentHistory } from '../history/service/assembly';

import type { AgentHistoryService } from '../history/runtime/agent-history';

import type { WorkspaceExecutionManager } from '../conversation/runtime/execution-manager';

import { Catalog } from '../workspace/service/catalog';

import { createApplicationInstances } from './assembly/application-instances';

import { Paths } from '../workspace/service/paths';

import { exists } from '../../core/io/text-files';

import { Rules } from '../knowledge/rules/knowledge';

import { Workspace } from '../workspace/service/workspace';

import type { ResourceRepositories } from '../../resource/service';

import { RepositoryConnections } from '../../resource/connections/service/repository-connections';

import { bindConnectorPackages, managedConnectorPackages, type ConnectorPackages } from './assembly/connector-packages';

import { connectorRegistrySchema } from '../../framework/connectors';

import type { WorkspaceMembers } from '../team/service/workspace-members';

import type { ModuleOwnerships } from '../workspace/service/module-ownerships';

/** 宿主可选能力的装配契约；不从页面或模型参数构造。 */
interface ApplicationPlatform
{
  /** 真实文件工人传输；缺省时不开放受控写入，查询已有记录仍可用。 */
  controlledFiles?: ControlledFileTransport;

  /** 源码或其它可信宿主提供的引擎解析器；已安装包管理器存在时优先使用后者。 */
  engineRuntimes?: EngineRuntimeResolver;

  modelAdapters?: ReturnType<typeof import('../engines').createModelAdapterRegistry>;

  connectorPackages?: ConnectorPackages;

  connectorServers?: import('../execution/assembly/loop-engine').ExecutionServices['ConnectorServers'];

  engineExtensions?: readonly import('../execution/rules/extensions').ExecutionExtension[];

  /** 正式冷宿主的制品端口，供应用建立唯一受管引擎包服务。 */
  engineArtifacts?: EngineArtifactsPort;

  /** 静态网页不足时使用的浏览器适配；Node 宿主可不提供。 */
  webBrowser?: BrowserReader;
}

/** 业务服务的唯一生命周期所有者；Bridge 子类只补充通信分发，不复制本类状态。 */
export class Application
{
  private readonly _connectorProducts?: ReturnType<typeof bindConnectorPackages>;

  public readonly connectorPackages?: ReturnType<typeof managedConnectorPackages>['manager'];

  private readonly cbimRuntime: CbimRuntime;

  /** 可信宿主注入的平台能力；普通对话选项不能替换文件传输或受管引擎解析。 */
  private readonly platform: ApplicationPlatform;

  /** 合并同工作区正在进行的打开请求；原 Promise 完成后移除。 */
  private opening = new Map<string, Promise<Workspace>>();

  /** 与本应用所有工作区共用的网页服务，持有缓存及每域限速。 */
  private readonly web: WebService;

  /** 每个打开工作区唯一的主会话执行管理器。 */
  private executions = new Map<string, WorkspaceExecutionManager>();

  /** 当前工作区的自动化服务；持久定义与本次调度生命周期分开。 */
  private automationServices = new Map<string, WorkspaceAutomations>();

  /** 本次真实主轮与安全等待占位共用入口；重开只恢复等待，绝不自动消费历史任务或结果。 */
  private collaborations = new Map<string, AutoCollaboration>();

  /** 每工作区唯一的业务派发服务，与知识来源及岗位服务共享 Store。 */
  private dispatchers = new Map<string, WorkspaceDispatchService>();

  /** 已装配工作区的岗位登记服务，不随页面切换重建。 */
  private memberRegistries = new Map<string, WorkspaceMembers>();

  /** 同一工作区的模块责任服务，复用原岗位和派发事务。 */
  private ownershipRegistries = new Map<string, ModuleOwnerships>();

  /** 与派发服务共享存储；关闭存储前先等待成员停止和结算尝试，失败记录保留供重开核实。 */
  private memberExecutions = new Map<string, MemberExecutionManager>();

  /** 本进程递增的工作区装配代际；重新打开不会复用旧等待身份。 */
  private nextAdmissionEpoch = 0;

  /** 每个工作区当前代际的撤销闭包，退役时取消通知并撤销等待票。 */
  private admissionOwners = new Map<string, () => void>();

  /** 每个工作区的监控接入对象，将已确认事件投影到应用只读监管。 */
  private monitors = new Map<string, WorkspaceRuntimeMonitor>();

  /** 角色历史不依赖当前知识定义；工作区退役只关闭服务，不删除用户目录归档。 */
  private histories = new Map<string, AgentHistoryService>();

  /** 关闭/重启跨 await 期间阻止新服务进入；计数允许 stop 等待一个正在重启的 open。 */
  private retiring = new Map<string, number>();

  /** 请求账本随工作区实例装配；关闭引擎结算后丢弃端口，不对历史预留做恢复写入。 */
  private requestBudgetServices = new Map<string, ModelRequestBudgetService>();

  /** 每个工作区的隔离资源服务；成员排空后才能等待其清理完成。 */
  private isolatedExecutionServices = new Map<string, IsolatedExecutions>();

  /** 每个工作区的受控文件服务；关闭 Store 前须确认原物理操作退出。 */
  private controlledFileServices = new Map<string, ControlledFiles>();

  /** 应用已开始退出；即使排空需要重试，也继续拒绝新业务请求。 */
  private stopping = false;

  /** 复用当前退出过程；仅特定排空未完成错误允许再次尝试原关闭。 */
  private shutdownPromise?: Promise<void>;

  /** 退役当前准入代际并移除撤销闭包；真实运行仍通过原释放函数归还名额。 */
  private RetireAdmission(id: string)
  {
    this.admissionOwners.get(id)?.();

    this.admissionOwners.delete(id);
  }

  /** 绑定一次工作区打开；退役只撤销票据与通知，不删除尚未释放的实际占用。 */
  private BindAdmission(workspace: Workspace, lease: WorkspaceExecutionLease): WorkspaceAdmission
  {
    const id = workspace.entry.id,
      ownerEpoch = ++this.nextAdmissionEpoch,
      controller = new AbortController();

    let current = true;

    const release = lease.ObserveRelease(() => this.admission.Wake());

    this.admissionOwners.set(id, () => { current = false; controller.abort(Error('工作区执行代际已退役')); release(); this.admission.RetireOwner(id, ownerEpoch); });

    return {
      manager: this.admission,
      ownerEpoch,
      signal: controller.signal,
      IsCurrent: () => current && !this.stopping && workspace.state === 'running' && this.running.get(id) === workspace,
    };
  }

  /** 进入工作区关闭或重启屏障，返回仅退出本次计数的闭包。 */
  private Retire(id: string)
  {
    this.retiring.set(id, (this.retiring.get(id) ?? 0) + 1);

    return () => { const count = this.retiring.get(id)! - 1; if (count) this.retiring.set(id, count); else this.retiring.delete(id); };
  }

  /** 拒绝应用退出及工作区退役期间的新服务请求，不隐式打开或恢复工程。 */
  private AssertServiceAvailable(id: string)
  {
    if (this.stopping)
      throw new Error('CBIM 正在退出');

    if (this.retiring.has(id))
      throw new Error('工作区正在关闭或重启，请稍后重试');
  }

  /** 应用数据与工作区目录的可信定位器，保持调用方传入的同一实例。 */
  public readonly paths: Paths;

  /** 用户目录中的工作区登记簿；登记信息与打开实例分开保存。 */
  public readonly catalog: Catalog;

  /** 只读运行资源的规则入口，资源根由可信宿主注入。 */
  public readonly rules: Rules;

  /** 按工作区 ID 保存当前实例；失败实例也保留，便于展示与显式重开。 */
  public readonly running = new Map<string, Workspace>();

  /** 应用共享的资源仓库服务，退出时在工作区排空后关闭。 */
  public readonly resources: ResourceRepositories;

  /** 用户目录中的独立工作区只读授权；登记知识不自动授权，应用退出先取消连接核验。 */
  public readonly repositoryConnections: RepositoryConnections;

  /** 应用独占的反馈授权与提交服务；退出先取消网络并等待原提交收尾。 */
  public readonly githubFeedback: GitHubFeedback;

  /** 显式资料导入有独立取消表；关闭先撤销，不因安全等待续跑再次联网。 */
  public readonly chatMaterials: ChatMaterialImports;

  /** 全应用共享供应商目录；公开 IPC 不返回凭据，运行时才解密。 */
  public readonly models: LlmProfiles;

  /** 引擎选型与协议投影独立于模型设置，复用同一个模型服务与设置队列。 */
  public readonly engineModels: EngineModelProfiles;

  /** 正式桌面由 C 注入制品端口；源码开发使用现有适配器，不伪造已安装状态。 */
  public readonly enginePackages?: EnginePackages;

  /** 应用共用公开网页缓存与限速；搜索设置不向模型公开密钥。 */
  public readonly webSettings: WebSettings;

  /** 按工作区保存主 Agent 选择；访问时核实当前实例与服务可用性。 */
  public readonly mainAgentSettings: MainAgentSettings;

  /** 应用级唯一监管投影；底层权威日志与执行权限仍归各工作区所有。 */
  public readonly runtime = new GlobalRuntimeManager();

  /** 准入控制与只读监管分离；名额只由真实租约领取/释放改变，策略保存后才生效。 */
  public readonly admission = new GlobalRunAdmission();

  /** 用户全局并发策略；恢复工作区之前安装到唯一准入服务。 */
  public readonly admissionSettings: AdmissionSettings;

  /** 保存的新默认仅在周期创建事务读取；运行中和安全等待沿用原周期冻结值。 */
  public readonly budgetSettings: BudgetSettings;

  /** IPC 新增工作区前检查关停状态；只暴露读取，不允许路由修改生命周期。 */
  public get isStopping()
  {
    return this.stopping;
  }

  /** 装配应用级服务；可信宿主提供工作区路径、密钥适配和平台端口，Init 编译代码内置规则并读取持久配置。 */
  // 可信文件传输同时供旧运行恢复与新 Agent 业务装配；公开对话参数不能替换该端口。
  public constructor(paths: Paths, secretCipher?: SecretCipher, platform: ApplicationPlatform = {})
  {
    this.paths = paths;

    this._connectorProducts = platform.connectorPackages && bindConnectorPackages(platform.connectorPackages);

    const instances = createApplicationInstances(paths);

    this.cbimRuntime = instances.cbimRuntime;

    this.resources = instances.resources;

    this.monitor = instances.monitor;

    this.platform = platform;

    if (platform.engineArtifacts)
    {
      const products = managedConnectorPackages(path.join(paths.userRoot, 'connector-installations.json'), platform.engineArtifacts);

      this.connectorPackages = products.manager;

      const custom = this._connectorProducts;

      this._connectorProducts = {
        Close: async () => { await custom?.Close(); },
        Open: async (context, agentId, moduleIds, signal, definitionId) => { const snapshot = await this.Workspace(context.workspaceId).Read(); const definitions = new Set([(definitionId ?? agentId) + '/agent.json', ...moduleIds.map(id => id + '/module.json')]); const refs = new Set<string>(); for (const file of snapshot.files.filter(file => definitions.has(file.path))) { const ids = JSON.parse(file.text).connectors; if (Array.isArray(ids)) for (const id of ids) refs.add(id); } const registry = snapshot.files.find(file => file.path === '.cbim/connectors/registry.json'); const ids = refs.size && registry ? connectorRegistrySchema.parse(JSON.parse(registry.text)).connectors.flatMap(entry => refs.has(entry.id) && 'productId' in entry ? [entry.productId] : []) : []; const other = await custom?.Open(context, agentId, moduleIds, signal); if (!ids.length) return other ?? { sessions: [], Release: async () => { } }; const leases = other ? [other] : []; const release = async () => { const results = await Promise.allSettled(leases.map(lease => lease.Release())); const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []); if (errors.length) throw new AggregateError(errors, '连接器释放失败'); }; try { for (const id of [...new Set(ids)].sort()) leases.push(await products.Open(id, context, signal)); return { sessions: leases.flatMap(lease => lease.sessions), Release: release }; } catch (error) { await release(); throw error; } }
      };

      this.enginePackages = new EnginePackages(
        path.join(paths.userRoot, 'engine-installations.json'),
        platform.engineArtifacts
      );
    }

    this.webSettings = new WebSettings(path.join(paths.userRoot, 'web-search.json'), secretCipher);

    this.web = new WebService(this.webSettings, undefined, undefined, platform.webBrowser);

    this.models = new LlmProfiles(path.join(paths.userRoot, 'llm.json'), secretCipher);

    this.engineModels = new EngineModelProfiles(this.models);

    this.mainAgentSettings = new MainAgentSettings(
      (id) => path.join(paths.Project(id), 'main-agent.json'),
      (identity) => { this.AssertServiceAvailable(identity.workspaceId); this.Workspace(identity.workspaceId).Assert(identity); },
      this.engineModels
    );

    this.githubFeedback = new GitHubFeedback(path.join(paths.userRoot, 'github-feedback'), secretCipher);

    this.admissionSettings = new AdmissionSettings(
      path.join(paths.userRoot, 'run-admission.json'),
      this.admission
    );

    this.budgetSettings = new BudgetSettings(path.join(paths.userRoot, 'scope-budget.json'));

    this.catalog = new Catalog(paths);

    this.rules = new Rules();

    this.repositoryConnections = new RepositoryConnections(
      path.join(paths.userRoot, 'repository-connections.json'),
      this.resources,
      (id) => { this.AssertServiceAvailable(id); const ws = this.Workspace(id); ws.Assert(); return ws; }
    );

    this.chatMaterials = new ChatMaterialImports((id) => { this.AssertServiceAvailable(id); const ws = this.Workspace(id); ws.Assert(); return ws; }, this.repositoryConnections);
  }

  /** 自动化仅在当前打开实例调度，关闭先停止新触发，再排空主/成员运行。 */
  public Automations(id: string)
  {
    this.AssertServiceAvailable(id);

    this.Workspace(id).Assert();

    const service = this.automationServices.get(id);

    if (!service)
      throw new Error('工作区自动化尚未就绪');

    return service;
  }

  /** 成员图与邮箱每工作区只有一个写入服务，沿用已持有的工作区锁。 */
  public MemberDispatch(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const service = this.dispatchers.get(id);

    if (!service)
      throw new Error('工作区成员服务尚未就绪');

    return service;
  }

  /** 岗位登记和旧命令查询只访问已打开工作区；旧实例回执由服务先查，不据当前来源重建。 */
  public WorkspaceMembers(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const service = this.memberRegistries.get(id);

    if (!service)
      throw new Error('工作区岗位登记尚未就绪');

    return service;
  }

  /** 模块责任共用岗位与派发日志；未接到业务执行策略，查询不启动任何运行。 */
  public WorkspaceOwnerships(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const service = this.ownershipRegistries.get(id);

    if (!service)
      throw new Error('工作区模块责任尚未就绪');

    return service;
  }

  /** 明确绑定工作区的成员执行入口；不依赖界面选中状态或普通对话的活动任务。 */
  public MemberExecution(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const service = this.memberExecutions.get(id);

    if (!service)
      throw new Error('工作区成员执行服务尚未就绪');

    return service;
  }

  /** 每个工作区实例唯一的执行管理器；调用必须显式指定工作区。 */
  public Execution(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const manager = this.executions.get(id);

    if (!manager)
      throw new Error('工作区执行服务尚未就绪');

    return manager;
  }

  /** 明确工作区的只读角色历史；没有执行、审批或恢复模型的副作用。 */
  public AgentHistory(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    const history = this.histories.get(id);

    if (!history)
      throw new Error('工作区 Agent 历史尚未就绪');

    return history;
  }

  /** 取得当前工作区已装配的请求预算服务，不恢复或重发历史请求。 */
  public RequestBudgets(id: string)
  {
    this.AssertServiceAvailable(id);

    this.Workspace(id).Assert();

    const service = this.requestBudgetServices.get(id);

    if (!service)
      throw new Error('请求预算服务尚未就绪');

    return service;
  }

  /** 只取得已打开工作区的原隔离记录，查询不启动程序或隐式清理。 */
  public IsolatedExecutions(id: string)
  {
    this.AssertServiceAvailable(id);

    this.Workspace(id).Assert();

    const service = this.isolatedExecutionServices.get(id);

    if (!service)
      throw new Error('隔离资源服务尚未就绪');

    return service;
  }

  /** 原报告不隐式打开工作区；平台缺省只禁新写入，不影响已保存历史查询。 */
  public ControlledFiles(id: string)
  {
    this.AssertServiceAvailable(id);

    this.Workspace(id).Assert();

    const service = this.controlledFileServices.get(id);

    if (!service)
      throw new Error('受控文件服务尚未就绪');

    return service;
  }

  /** 桌面可先初始化基础配置并显示窗口；默认仍恢复全部工作区，CLI/现有消费者行为不变。 */
  public async Init(options: { /** false 仅初始化应用配置；工作区恢复由可信宿主稍后显式调用。 */ restore?: boolean; } = {})
  {
    await this.enginePackages?.Init();

    await this.webSettings.Init();

    await this.catalog.Init();

    await this.rules.Init();

    await this.resources.Init();

    await this.repositoryConnections.Init();

    await this.admissionSettings.Init();

    await this.budgetSettings.Init();

    if (options.restore !== false)
      await this.Restore();
  }

  /** 合并登记簿与当前实例视图；未打开的工作区只检查目录是否存在。 */
  public async List()
  {
    const data = await this.catalog.Read();

    return {
      ...data,
      warning: this.catalog.warning,
      entries: await Promise.all(
        data.entries.map(
          async (e) => this.running.get(e.id)?.View() || { ...e, state: (await exists(e.path)) ? 'registered' : 'missing', tasks: [], }
        )
      ),
    };
  }

  /** 仅取得已登记在运行集合中的实例；调用方继续按业务需要核实其就绪状态。 */
  public readonly monitor: RuntimeMonitor;

  public async OpenWorkspaceInstance(workspaceId: string, rootSessionId: string, nodeId: string, relativeDirectory: string)
  {
    this.AssertServiceAvailable(workspaceId);

    const workspace = this.Workspace(workspaceId);

    const office = await openProjectOffice(this.cbimRuntime, workspace, rootSessionId, this.memberRegistries.get(workspaceId), true);

    return office.OpenWorkspace(nodeId, workspace.entry.path, relativeDirectory);
  }

  public Workspace(id: string)
  {
    const ws = this.running.get(id);

    if (!ws)
      throw new Error('工作区未运行，请由用户在桌面打开');

    return ws;
  }

  /** 只取得已就绪工作区的私有治理服务；不把计划或决定接到模型执行入口。 */
  public Governance(id: string)
  {
    this.AssertServiceAvailable(id);

    const ws = this.Workspace(id);

    ws.Assert();

    return ws.governance;
  }

  /** 合并同工作区的并发打开并装配内部执行服务；restart 只更换此工作区实例，不修改外部工具配置。 */
  public async Open(id: string, restart = false)
  {
    if (this.stopping)
      throw new Error('CBIM 正在退出');

    if (this.opening.has(id))
      return this.opening.get(id)!;

    this.AssertServiceAvailable(id);

    const pending = (async () =>
    {
      const entry = (await this.catalog.Read()).entries.find((x) => x.id === id);

      if (!entry)
        throw new Error('工作区未登记');

      let ws = this.running.get(id);

      if (restart || ws?.state !== 'running')
      {
        const release = this.Retire(id);

        try
        {
          // 退役先阻止旧代际的新活动；后续异步排空期间不能再进入新业务。
          this.chatMaterials.RetireWorkspace(id);

          this.repositoryConnections.RetireWorkspace(id);

          this.RetireAdmission(id);

          await this.automationServices.get(id)?.scheduler.Close();

          this.automationServices.delete(id);

          await this.collaborations.get(id)?.Close();

          this.collaborations.delete(id);

          await this.executions.get(id)?.Close();

          this.executions.delete(id);

          await this.cbimRuntime.CloseWorkspace(id);

          await this.memberExecutions.get(id)?.Close();

          this.memberExecutions.delete(id);

          await this.controlledFileServices.get(id)?.Close();

          this.controlledFileServices.delete(id);

          await this.isolatedExecutionServices.get(id)?.Close();

          this.isolatedExecutionServices.delete(id);

          this.requestBudgetServices.delete(id);

          await ws?.PrepareClose();

          await this.dispatchers.get(id)?.Close();

          this.dispatchers.delete(id);

          this.memberRegistries.delete(id);

          this.ownershipRegistries.delete(id);

          this.monitors.get(id)?.Close();

          await this.histories.get(id)?.Close();

          this.histories.delete(id);

          await ws?.Close();

          // 旧实例成功关闭后才替换；新 Store 在 Workspace 持锁阶段加载。
          ws = new Workspace(entry, this.paths, this.rules);

          this.running.set(id, ws);

          const history = createAgentHistory(ws, (message) => this.monitors.get(id)?.HistoryIssue(message));

          this.histories.set(id, history);

          const monitor = new WorkspaceRuntimeMonitor(this.runtime, id, entry.name, history);

          this.monitors.set(id, monitor);

          try
          {
            ws.AttachDispatchStore(
              new FileDispatchStore(
                path.join(this.paths.Project(id), 'dispatch'),
                id,
                monitor.dispatchObserver
              )
            );

            await ws.Open({ beforeDispatchLoad: () => monitor.InitializeHistory() });

            const lease = new WorkspaceExecutionLease(),
              admission = this.BindAdmission(ws, lease),
              {
                dispatch: service,
                members,
                workspaceMembers,
                moduleOwnerships,
                controlledFiles,
                isolatedExecutions,
                requestBudgets,
                businessRuns,
              } = createMemberServices(
                ws,
                this.engineModels,
                lease,
                monitor.dispatchObserver,
                admission,
                () => this.budgetSettings.Read(),
                this.platform.controlledFiles,
                this.enginePackages ?? this.platform.engineRuntimes,
                this.platform.engineExtensions,
                this.platform.modelAdapters,
                (rootSessionId, scopeId) => this.collaborations.get(id)?.MemberPermission(rootSessionId, scopeId)
              ),
              execution = createExecutionManager(
                this.cbimRuntime,
                ws,
                this.engineModels,
                lease,
                () => this.collaborations.get(id),
                service,
                admission,
                this.repositoryConnections,
                { service: moduleOwnerships, members: workspaceMembers },
                requestBudgets,
                this.githubFeedback,
                this.web,
                this.enginePackages ?? this.platform.engineRuntimes,
                this.platform.controlledFiles,
                { runs: businessRuns, controlledFiles, isolatedExecutions },
                this.platform.engineExtensions,
                this.platform.modelAdapters,
                this.platform.connectorServers,
                this._connectorProducts
              );

            this.dispatchers.set(id, service);

            this.executions.set(id, execution);

            this.memberExecutions.set(id, members);

            this.memberRegistries.set(id, workspaceMembers);

            this.ownershipRegistries.set(id, moduleOwnerships);

            this.controlledFileServices.set(id, controlledFiles);

            this.isolatedExecutionServices.set(id, isolatedExecutions);

            this.requestBudgetServices.set(id, requestBudgets);

            await monitor.Initialize(ws, service, execution, members);

            const collaboration = new AutoCollaboration(
              ws,
              service,
              members,
              execution,
              lease,
              (root, error) => monitor.CollaborationIssue(root, error)
            );

            this.collaborations.set(id, collaboration);

            await collaboration.Initialize();

            const automations = new WorkspaceAutomations(
              ws,
              execution,
              service,
              collaboration,
              (permission) => this.ChatOptions(id, { permission, collaborationMode: 'team' }, [])
            );

            this.automationServices.set(id, automations);

            await automations.scheduler.Initialize();
          }
          catch (error)
          {
            // 知识库打开成功不代表内部服务已就绪。等待恢复若中途失败，阻止半就绪服务接受请求；下次 open 走统一关闭/重建路径。
            this.RetireAdmission(id);

            monitor.Unavailable(error);

            ws.error = '工作区服务初始化失败：' + (error instanceof Error ? error.message : String(error));

            ws.state = 'failed';

            throw error;
          }
        }
        finally
        {
          release();
        }
      }

      await this.catalog.Update((d) => { const item = d.entries.find((e) => e.id === id); if (item) item.lastOpened = new Date().toISOString(); d.recent = [id, ...d.recent.filter((x) => x !== id)].slice(0, 30); });

      return ws;
    })();

    this.opening.set(id, pending);

    try
    {
      return await pending;
    }
    finally
    {
      this.opening.delete(id);
    }
  }

  /** 内部生命周期入口；先禁用自动协作，再依次关闭主执行、成员、派发、监控和工作区，页面关闭不会调用它。 */
  public async Stop(id: string)
  {
    const release = this.Retire(id);

    this.chatMaterials.RetireWorkspace(id);

    this.repositoryConnections.RetireWorkspace(id);

    this.RetireAdmission(id);

    try
    {
      await this.opening.get(id)?.catch(() => { });

      this.RetireAdmission(id);

      await this.automationServices.get(id)?.scheduler.Close();

      this.automationServices.delete(id);

      await this.collaborations.get(id)?.Close();

      this.collaborations.delete(id);

      await this.executions.get(id)?.Close();

      this.executions.delete(id);

      await this.cbimRuntime.CloseWorkspace(id);

      await this.memberExecutions.get(id)?.Close();

      this.memberExecutions.delete(id);

      await this.controlledFileServices.get(id)?.Close();

      this.controlledFileServices.delete(id);

      await this.isolatedExecutionServices.get(id)?.Close();

      this.isolatedExecutionServices.delete(id);

      this.requestBudgetServices.delete(id);

      await this.running.get(id)?.PrepareClose();

      await this.dispatchers.get(id)?.Close();

      this.dispatchers.delete(id);

      this.memberRegistries.delete(id);

      this.ownershipRegistries.delete(id);

      this.monitors.get(id)?.Close();

      await this.histories.get(id)?.Close();

      this.histories.delete(id);

      this.monitors.delete(id);

      const ws = this.running.get(id);

      await ws?.Close();

      this.running.delete(id);
    }
    finally
    {
      release();
    }
  }

  /** 先关闭目标工作区，再移除登记和监管投影；不删除用户工程文件。 */
  public async Remove(id: string)
  {
    await this.Stop(id);

    await this.catalog.Remove(id);

    this.runtime.Forget(id);
  }

  /** 仍按原策略恢复全部已登记工作区；与界面手动打开合并，退出后不再开始新的恢复。 */
  public async Restore()
  {
    const d = await this.catalog.Read();

    for (const entry of d.entries)
    {
      if (this.stopping)
        break;

      try
      {
        await this.Open(entry.id);
      }
      catch
      {
        // 保留失败工作区供界面查看，继续恢复其他已登记工作区。
      }
    }
  }

  /** 幂等关闭应用，等待正在打开的工作区及提交完成，再释放服务和共享仓库。 */
  public async Shutdown()
  {
    if (this.shutdownPromise)
      return this.shutdownPromise;

    this.stopping = true;

    for (const id of this.admissionOwners.keys())
      this.RetireAdmission(id);

    this.shutdownPromise = (async () => { await this.githubFeedback.Close(); await this.chatMaterials.Close(); await this.repositoryConnections.Close(); await Promise.allSettled([...this.opening.values()]); for (const id of this.admissionOwners.keys()) this.RetireAdmission(id); await Promise.all([...this.automationServices.values()].map((x) => x.scheduler.Close())); this.automationServices.clear(); await Promise.all([...this.collaborations.values()].map((x) => x.Close())); this.collaborations.clear(); await Promise.all([...this.executions.values(), ...this.memberExecutions.values()].map((x) => x.Close())); this.executions.clear(); await this._connectorProducts?.Close(); this.monitor.Close(); await this.cbimRuntime.Close(); this.memberExecutions.clear(); await Promise.all([...this.controlledFileServices.values()].map((x) => x.Close())); this.controlledFileServices.clear(); await Promise.all([...this.isolatedExecutionServices.values()].map((x) => x.Close())); this.isolatedExecutionServices.clear(); await this.platform.controlledFiles?.Close(); await Promise.all([...this.running.values()].map((w) => w.PrepareClose())); await Promise.all([...this.dispatchers.values()].map((x) => x.Close())); this.dispatchers.clear(); this.memberRegistries.clear(); this.ownershipRegistries.clear(); for (const monitor of this.monitors.values()) monitor.Close(); await Promise.all([...this.histories.values()].map((x) => x.Close())); this.histories.clear(); this.monitors.clear(); const results = await Promise.allSettled([...this.running.values()].map((w) => w.Close())); await this.resources.Close(); this.running.clear(); const failed = results.find((r) => r.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason; })();

    void this.shutdownPromise.catch((error) => { if (['CONTROLLED_FILE_DRAIN_PENDING', 'EXECUTION_SCOPE_DRAIN_PENDING'].includes(error?.code)) this.shutdownPromise = undefined; });

    return this.shutdownPromise;
  }

  /** 默认选择转为独立引擎及明确模型身份，校验协议后仅向调度层返回公开标识；工作区工厂随后取得运行快照，兼容 CLI 显式模型。 */
  public async ModelOptions(input: any = {})
  {
    if (input?.provider && input?.model && !input.profileId)
      return input;

    const { profile } = await this.engineModels.Resolve(
      input?.profileId,
      input?.model,
      input?.engine,
      input?.modelRoles
    );

    return {
      ...input,
      engine: profile.engine ?? 'pi',
      provider: 'cbim-' + profile.id,
      model: profile.model,
      profileId: profile.id,
    };
  }

  /** 发送前验证图片能力；队列只保存工作区快照 ID，启动时再检查当前模型。 */
  public async ChatOptions(id: string, input: any, attachments: unknown)
  {
    if (!input?.profileId && !input?.provider && !input?.model && !input?.engine)
    {
      const workspace = this.Workspace(id),
        setting = await this.mainAgentSettings.Read({ workspaceId: id, instanceId: workspace.instanceId });

      if (setting.selection)
      {
        input = {
          ...input,
          engine: setting.selection.engine,
          profileId: setting.selection.profileId,
          model: setting.selection.modelId,
          ...(setting.selection.modelRoles === undefined ? {} : { modelRoles: setting.selection.modelRoles }),
        };
      }
    }

    const options = await this.ModelOptions(input);

    const images = await new ChatInputs(this.Workspace(id)).Images(attachments);

    if (
      images.length &&
      options.profileId &&
      !(await this.models.Resolve(options.profileId, options.model)).profile.vision
    )
      throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');

    return { ...options, attachmentIds: attachments ?? [] };
  }
}
