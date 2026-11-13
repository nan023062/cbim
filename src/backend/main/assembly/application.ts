/**
 * 目录归属：backend/main/assembly；应用与执行服务装配。

 * 公开网页服务由应用共用缓存与限速；桌面注入匿名浏览器兜底，Node 消费者仍可独立使用静态服务。
 * 自动化随当前工作区唯一装配；退役先取消调度准备，再排空协作/执行，持久定义不恢复历史模型。
 * 隔离资源服务随工作区实例创建；成员排空后等待原清理日志，未确认隔离退出时应用可再次尝试原关闭。
 * 受控文件边界：Electron 显式注入 utility 传输，普通 Node 不直接写；关闭先确认原文件 child 退出，随后才关闭共享 Store 和工作区锁。
 * 请求预算在工作区实例内共用唯一账本服务；先关闭主/成员代理并结算，再释放 Store，查询本身不会启动或恢复请求。
 * 历史装配：本层组合只读角色服务与索引／日志端口，持锁初始化和关闭排空仍由本生命周期管理。
 * 作用定位：单次运行授权、版本化队列增量和结构化问题按工作区路由；排队时冻结附件内容与模型身份。Application：登记及重命名工作区、装配模型供应商与服务，并统一派发主 Agent 对话、附件快照、工具审批和历史操作。
 * 设计原因：主会话绑定独立主实例；应用共享并发准入，软限额设置在新周期创建时冻结。工作区代际隔离等待票据；关闭先撤票再停运行和排空历史，不通过删除观察记录假释放名额。
 * 资源连接：独立本机授权先恢复但不启动共享；主工具及桌面显式资料导入复用真实只读连接。工作区退役先取消导入和读取，退出排空后关闭 HTTP 服务。
 * GitHub 反馈：应用独占本机授权与提交服务；主会话只持有固定目标端口，退出先取消网络再排空原提交，未知结果不会自动重放。
 * 模块治理：仅已就绪 Workspace 提供桌面保护与人工决定服务；实际知识实施仍排入原事务队列，重开不执行保存的意图。
 * 岗位责任：恢复前注入唯一派发存储；持锁核实路径后先初始化历史索引，再加载该存储并恢复来源事务。来源、岗位与模块负责人共用原命令查询；关闭先排空知识结算再关闭该存储。登记与来源采纳不创建运行实例，不改变任务派发或模型策略。
 * 主 Agent 配置归工作区角色，两处界面共用；发送时读取并冻结引擎与模型引用，按接口协议校验，已受理的执行不会随设置热切换。
 * IPC 边界：已知操作返回关联响应，原始输入保持 unknown 至共享请求解析，应用不提供 any 通配响应。
 * 桌面可只初始化目录再创建窗口，随后恢复工作区；停止标记阻止背景恢复继续打开下一工程。受管引擎解析端口只由可信宿主装配。
 */
import type {IpcAction,IpcResponse} from '../../../bridge/contracts/ipc-call';
import path from 'node:path';
import {WebSettings} from '../settings/web-settings';
import {WebService} from '../web/web-service';
import type {BrowserReader} from '../../core/foundation/web';
import {WorkspaceAutomations} from '../automation/service';
import type {ControlledFileTransport} from '../platform/files/controlled-file-protocol';
import type {ModelRequestBudgetService} from '../../scheduler-engine/budget/model-request-budget-service';
import type {ControlledFiles} from '../file-operations/controlled-files';
import type {IsolatedExecutions} from '../file-operations/isolated-executions';
import {dispatchApplication} from '../ipc/dispatch';
import type {ApplicationServices} from '../ipc/services';
import {LlmProfiles,type SecretCipher} from '../models/llm-profiles';
import {MainAgentSettings} from '../models/main-agent-settings';
import {AdmissionSettings} from '../settings/admission-settings';
import {BudgetSettings} from '../settings/budget-settings';
import {GitHubFeedback} from '../feedback/github-feedback';
import {createExecutionManager} from './execution';
import type {EngineRuntimeResolver} from '../../core/execution/engine-runtime';
import {createMemberServices} from './member-dispatch';
import {FileDispatchStore} from '../dispatch-storage/dispatch-store';
import type {WorkspaceDispatchService} from '../../scheduler-engine/dispatch/dispatch-service';
import type {MemberExecutionManager} from '../../scheduler-engine/members/member-execution';
import {WorkspaceExecutionLease} from '../../scheduler-engine/admission/workspace-lease';
import {AutoCollaboration} from '../../scheduler-engine/dispatch/auto-collaboration';
import {GlobalRuntimeManager} from '../../scheduler-engine/runtime/global-runtime';
import {GlobalRunAdmission} from '../../scheduler-engine/admission/run-admission';
import type {WorkspaceAdmission} from './execution-admission';
import {WorkspaceRuntimeMonitor} from './runtime-monitor';
import {ChatInputs} from '../materials/chat-inputs';
import {ChatMaterialImports} from '../materials/chat-material-imports';
import {createAgentHistory} from '../history/assembly';
import type {AgentHistoryService} from '../../scheduler-engine/history/agent-history';
import type {WorkspaceExecutionManager} from '../../scheduler-engine/conversation/execution-manager';
import {Catalog} from '../workspace/catalog';
import {Paths} from '../platform/paths';
import {exists} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {Rules} from '../../core/knowledge/knowledge';
import {Workspace} from '../workspace/workspace';
import {ResourceRepositories} from '../resources/resource-repository';
import {RepositoryConnections} from '../resources/repository-connections';
import type {WorkspaceMembers} from '../registry/workspace-members';
import type {ModuleOwnerships} from '../registry/module-ownerships';
/** 实现路由所需的服务契约；IPC 层不反向依赖本应用类。 */
export class Application implements ApplicationServices {
  readonly catalog:Catalog;readonly rules:Rules;readonly running=new Map<string,Workspace>();private opening=new Map<string,Promise<Workspace>>();
  readonly resources:ResourceRepositories;
  /** 用户目录中的独立工作区只读授权；登记知识不自动授权，应用退出先取消连接核验。 */
  readonly repositoryConnections:RepositoryConnections;
  readonly githubFeedback:GitHubFeedback;
  /** 显式资料导入有独立取消表；关闭先撤销，不因安全等待续跑再次联网。 */
  readonly chatMaterials:ChatMaterialImports;
  /** 全应用共享供应商目录；公开 IPC 不返回凭据，运行时才解密。 */
  readonly models:LlmProfiles;
  /** 应用共用公开网页缓存与限速；搜索设置不向模型公开密钥。 */
  readonly webSettings:WebSettings;
  private readonly web:WebService;
  readonly mainAgentSettings:MainAgentSettings;
  private executions=new Map<string,WorkspaceExecutionManager>();
  private automationServices=new Map<string,WorkspaceAutomations>();
  /** 自动化仅在当前打开实例调度，关闭先停止新触发，再排空主/成员运行。 */
  automations(id:string){this.assertServiceAvailable(id);this.workspace(id).assert();const service=this.automationServices.get(id);if(!service)fail('SERVICE_NOT_READY','工作区自动化尚未就绪');return service}
  /** 本次真实主轮与安全等待占位共用入口；重开只恢复等待，绝不自动消费历史任务或结果。 */
  private collaborations=new Map<string,AutoCollaboration>();
  private dispatchers=new Map<string,WorkspaceDispatchService>();
  private memberRegistries=new Map<string,WorkspaceMembers>();
  private ownershipRegistries=new Map<string,ModuleOwnerships>();
  /** 与派发服务共享存储；关闭存储前先等待成员停止和结算尝试，失败记录保留供重开核实。 */
  private memberExecutions=new Map<string,MemberExecutionManager>();
  /** 应用级唯一监管投影；底层权威日志与执行权限仍归各工作区所有。 */
  readonly runtime=new GlobalRuntimeManager();
  /** 准入控制与只读监管分离；名额只由真实租约领取/释放改变，策略保存后才生效。 */
  readonly admission=new GlobalRunAdmission();
  readonly admissionSettings:AdmissionSettings;
  /** 保存的新默认仅在周期创建事务读取；运行中和安全等待沿用原周期冻结值。 */
  readonly budgetSettings:BudgetSettings;
  private nextAdmissionEpoch=0;
  private admissionOwners=new Map<string,()=>void>();
  private retireAdmission(id:string){this.admissionOwners.get(id)?.();this.admissionOwners.delete(id)}
  /** 绑定一次工作区打开；退役只撤销票据与通知，不删除尚未释放的实际占用。 */
  private bindAdmission(workspace:Workspace,lease:WorkspaceExecutionLease):WorkspaceAdmission{
    const id=workspace.entry.id,ownerEpoch=++this.nextAdmissionEpoch,controller=new AbortController();let current=true;
    const release=lease.observeRelease(()=>this.admission.wake());
    this.admissionOwners.set(id,()=>{current=false;controller.abort(Error('工作区执行代际已退役'));release();this.admission.retireOwner(id,ownerEpoch)});
    return {manager:this.admission,ownerEpoch,signal:controller.signal,isCurrent:()=>current&&!this.stopping&&workspace.state==='running'&&this.running.get(id)===workspace};
  }
  private monitors=new Map<string,WorkspaceRuntimeMonitor>();
  /** 角色历史不依赖当前知识定义；工作区退役只关闭服务，不删除用户目录归档。 */
  private histories=new Map<string,AgentHistoryService>();
  /** 关闭/重启跨 await 期间阻止新服务进入；计数允许 stop 等待一个正在重启的 open。 */
  private retiring=new Map<string,number>();
  private retire(id:string){this.retiring.set(id,(this.retiring.get(id)??0)+1);return ()=>{const count=this.retiring.get(id)!-1;if(count)this.retiring.set(id,count);else this.retiring.delete(id)}}
  private assertServiceAvailable(id:string){if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');if(this.retiring.has(id))fail('WORKSPACE_STOPPING','工作区正在关闭或重启，请稍后重试')}
  /** 成员图与邮箱每工作区只有一个写入服务，沿用已持有的工作区锁。 */
  memberDispatch(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const service=this.dispatchers.get(id);if(!service)fail('SERVICE_NOT_READY','工作区成员服务尚未就绪');return service}
  /** 岗位登记和旧命令查询只访问已打开工作区；旧实例回执由服务先查，不据当前来源重建。 */
  workspaceMembers(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const service=this.memberRegistries.get(id);if(!service)fail('SERVICE_NOT_READY','工作区岗位登记尚未就绪');return service}
  /** 模块责任共用岗位与派发日志；未接到业务执行策略，查询不启动任何运行。 */
  workspaceOwnerships(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const service=this.ownershipRegistries.get(id);if(!service)fail('SERVICE_NOT_READY','工作区模块责任尚未就绪');return service}
  /** 明确绑定工作区的成员执行入口；不依赖界面选中状态或普通对话的活动任务。 */
  memberExecution(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const service=this.memberExecutions.get(id);if(!service)fail('SERVICE_NOT_READY','工作区成员执行服务尚未就绪');return service}
  /** 每个工作区实例唯一的执行管理器；调用必须显式指定工作区。 */
  execution(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const manager=this.executions.get(id);if(!manager)fail('SERVICE_NOT_READY','工作区执行服务尚未就绪');return manager}
  /** 明确工作区的只读角色历史；没有执行、审批或恢复模型的副作用。 */
  agentHistory(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const history=this.histories.get(id);if(!history)fail('SERVICE_NOT_READY','工作区 Agent 历史尚未就绪');return history}
  /** 请求账本随工作区实例装配；关闭引擎结算后丢弃端口，不对历史预留做恢复写入。 */
  private requestBudgetServices=new Map<string,ModelRequestBudgetService>();
  requestBudgets(id:string){this.assertServiceAvailable(id);this.workspace(id).assert();const service=this.requestBudgetServices.get(id);if(!service)fail('SERVICE_NOT_READY','请求预算服务尚未就绪');return service}
  private isolatedExecutionServices=new Map<string,IsolatedExecutions>();
  /** 只取得已打开工作区的原隔离记录，查询不启动程序或隐式清理。 */
  isolatedExecutions(id:string){this.assertServiceAvailable(id);this.workspace(id).assert();const service=this.isolatedExecutionServices.get(id);if(!service)fail('SERVICE_NOT_READY','隔离资源服务尚未就绪');return service}
  private controlledFileServices=new Map<string,ControlledFiles>();
  /** 原报告不隐式打开工作区；平台缺省只禁新写入，不影响已保存历史查询。 */
  controlledFiles(id:string){this.assertServiceAvailable(id);this.workspace(id).assert();const service=this.controlledFileServices.get(id);if(!service)fail('SERVICE_NOT_READY','受控文件服务尚未就绪');return service}
  private stopping=false;private shutdownPromise?:Promise<void>;
  /** IPC 新增工作区前检查关停状态；只暴露读取，不允许路由修改生命周期。 */
  get isStopping(){return this.stopping}
  constructor(readonly paths:Paths,designRoot:string,secretCipher?:SecretCipher,private readonly platform:{controlledFiles?:ControlledFileTransport;engineRuntimes?:EngineRuntimeResolver;webBrowser?:BrowserReader}={}) {this.webSettings=new WebSettings(path.join(paths.userRoot,'web-search.json'),secretCipher);this.web=new WebService(this.webSettings,undefined,undefined,platform.webBrowser);this.models=new LlmProfiles(path.join(paths.userRoot,'llm.json'),secretCipher);this.mainAgentSettings=new MainAgentSettings(id=>path.join(paths.project(id),'main-agent.json'),identity=>{this.assertServiceAvailable(identity.workspaceId);this.workspace(identity.workspaceId).assert(identity)},this.models);this.githubFeedback=new GitHubFeedback(path.join(paths.userRoot,'github-feedback'),secretCipher);this.admissionSettings=new AdmissionSettings(path.join(paths.userRoot,'run-admission.json'),this.admission);this.budgetSettings=new BudgetSettings(path.join(paths.userRoot,'scope-budget.json'));this.catalog=new Catalog(paths);this.rules=new Rules(designRoot);this.resources=new ResourceRepositories(paths);this.repositoryConnections=new RepositoryConnections(path.join(paths.userRoot,'repository-connections.json'),this.resources,id=>{this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();return ws});this.chatMaterials=new ChatMaterialImports(id=>{this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();return ws},this.repositoryConnections)}
  /** 桌面可先初始化基础配置并显示窗口；默认仍恢复全部工作区，CLI/现有消费者行为不变。 */
  async init(options:{restore?:boolean}={}){await this.webSettings.init();await this.catalog.init();await this.rules.init();await this.resources.init();await this.repositoryConnections.init();await this.admissionSettings.init();await this.budgetSettings.init();if(options.restore!==false)await this.restore()}
  async list(){const data=await this.catalog.read();return {...data,warning:this.catalog.warning,entries:await Promise.all(data.entries.map(async e=>this.running.get(e.id)?.view()||{...e,state:await exists(e.path)?'registered':'missing',tasks:[]}))}}
  workspace(id:string){const ws=this.running.get(id);if(!ws)fail('NOT_RUNNING','工作区未运行，请由用户在桌面打开');return ws}
  /** 只取得已就绪工作区的私有治理服务；不把计划或决定接到模型执行入口。 */
  governance(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();return ws.governance}
  /** 合并同工作区的并发打开并装配内部执行服务；restart 只更换此工作区实例，不修改外部工具配置。 */
  async open(id:string,restart=false){if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');if(this.opening.has(id))return this.opening.get(id)!;this.assertServiceAvailable(id);
    const pending=(async()=>{const entry=(await this.catalog.read()).entries.find(x=>x.id===id);if(!entry)fail('NOT_REGISTERED','工作区未登记');let ws=this.running.get(id);
      if(restart||ws?.state!=='running'){const release=this.retire(id);try{
        this.chatMaterials.retireWorkspace(id);
        this.repositoryConnections.retireWorkspace(id);
        this.retireAdmission(id);
        await this.automationServices.get(id)?.scheduler.close();this.automationServices.delete(id);await this.collaborations.get(id)?.close();this.collaborations.delete(id);
        await this.executions.get(id)?.close();this.executions.delete(id);
        await this.memberExecutions.get(id)?.close();this.memberExecutions.delete(id);await this.controlledFileServices.get(id)?.close();this.controlledFileServices.delete(id);await this.isolatedExecutionServices.get(id)?.close();this.isolatedExecutionServices.delete(id);this.requestBudgetServices.delete(id);
        await ws?.prepareClose();await this.dispatchers.get(id)?.close();this.dispatchers.delete(id);this.memberRegistries.delete(id);this.ownershipRegistries.delete(id);
        this.monitors.get(id)?.close();await this.histories.get(id)?.close();this.histories.delete(id);await ws?.close();
        ws=new Workspace(entry,this.paths,this.rules);this.running.set(id,ws);
        const history=createAgentHistory(ws,message=>this.monitors.get(id)?.historyIssue(message));this.histories.set(id,history);
        const monitor=new WorkspaceRuntimeMonitor(this.runtime,id,entry.name,history);this.monitors.set(id,monitor);
        try{
          ws.attachDispatchStore(new FileDispatchStore(path.join(this.paths.project(id),'dispatch'),id,monitor.dispatchObserver));
          await ws.open({beforeDispatchLoad:()=>monitor.initializeHistory()});
          const lease=new WorkspaceExecutionLease(),admission=this.bindAdmission(ws,lease),{dispatch:service,members,workspaceMembers,moduleOwnerships,controlledFiles,isolatedExecutions,requestBudgets}=createMemberServices(ws,this.models,lease,monitor.dispatchObserver,admission,()=>this.budgetSettings.read(),this.platform.controlledFiles,this.platform.engineRuntimes),execution=createExecutionManager(ws,this.models,lease,()=>this.collaborations.get(id),service,admission,this.repositoryConnections,{service:moduleOwnerships,members:workspaceMembers},requestBudgets,this.githubFeedback,this.web,this.platform.engineRuntimes);
          this.dispatchers.set(id,service);this.executions.set(id,execution);this.memberExecutions.set(id,members);this.memberRegistries.set(id,workspaceMembers);this.ownershipRegistries.set(id,moduleOwnerships);this.controlledFileServices.set(id,controlledFiles);this.isolatedExecutionServices.set(id,isolatedExecutions);this.requestBudgetServices.set(id,requestBudgets);
          await monitor.initialize(ws,service,execution,members);
          const collaboration=new AutoCollaboration(ws,service,members,execution,lease,(root,error)=>monitor.collaborationIssue(root,error));
          this.collaborations.set(id,collaboration);await collaboration.initialize();
          const automations=new WorkspaceAutomations(ws,execution,service,collaboration,permission=>this.chatOptions(id,{permission,collaborationMode:'team'},[]));this.automationServices.set(id,automations);await automations.scheduler.initialize();
        }catch(error){
          // 知识库打开成功不代表内部服务已就绪。等待恢复若中途失败，阻止半就绪服务接受请求；下次 open 走统一关闭/重建路径。
          this.retireAdmission(id);monitor.unavailable(error);ws.error='工作区服务初始化失败：'+(error instanceof Error?error.message:String(error));ws.state='failed';throw error;
        }
      }finally{release()}}
      await this.catalog.update(d=>{const item=d.entries.find(e=>e.id===id);if(item)item.lastOpened=new Date().toISOString();d.recent=[id,...d.recent.filter(x=>x!==id)].slice(0,30)});return ws})();this.opening.set(id,pending);try{return await pending}finally{this.opening.delete(id)}
  }
  /** 内部生命周期入口；先禁用自动协作，再依次关闭主执行、成员、派发、监控和工作区，页面关闭不会调用它。 */
  async stop(id:string){const release=this.retire(id);this.chatMaterials.retireWorkspace(id);this.repositoryConnections.retireWorkspace(id);this.retireAdmission(id);try{await this.opening.get(id)?.catch(()=>{});this.retireAdmission(id);await this.automationServices.get(id)?.scheduler.close();this.automationServices.delete(id);await this.collaborations.get(id)?.close();this.collaborations.delete(id);await this.executions.get(id)?.close();this.executions.delete(id);await this.memberExecutions.get(id)?.close();this.memberExecutions.delete(id);await this.controlledFileServices.get(id)?.close();this.controlledFileServices.delete(id);await this.isolatedExecutionServices.get(id)?.close();this.isolatedExecutionServices.delete(id);this.requestBudgetServices.delete(id);await this.running.get(id)?.prepareClose();await this.dispatchers.get(id)?.close();this.dispatchers.delete(id);this.memberRegistries.delete(id);this.ownershipRegistries.delete(id);this.monitors.get(id)?.close();await this.histories.get(id)?.close();this.histories.delete(id);this.monitors.delete(id);const ws=this.running.get(id);await ws?.close();this.running.delete(id)}finally{release()}}
  async remove(id:string){await this.stop(id);await this.catalog.remove(id);this.runtime.forget(id)}
  /** 仍按原策略恢复全部已登记工作区；与界面手动打开合并，退出后不再开始新的恢复。 */
  async restore(){const d=await this.catalog.read();for(const entry of d.entries){if(this.stopping)break;try{await this.open(entry.id)}catch{/* failed workspace remains visible; continue the other services */}}}
  /** 幂等关闭应用，等待正在打开的工作区及提交完成，再释放服务和共享仓库。 */
  async shutdown(){if(this.shutdownPromise)return this.shutdownPromise;this.stopping=true;for(const id of this.admissionOwners.keys())this.retireAdmission(id);this.shutdownPromise=(async()=>{await this.githubFeedback.close();await this.chatMaterials.close();await this.repositoryConnections.close();await Promise.allSettled([...this.opening.values()]);for(const id of this.admissionOwners.keys())this.retireAdmission(id);await Promise.all([...this.automationServices.values()].map(x=>x.scheduler.close()));this.automationServices.clear();await Promise.all([...this.collaborations.values()].map(x=>x.close()));this.collaborations.clear();await Promise.all([...this.executions.values(),...this.memberExecutions.values()].map(x=>x.close()));this.executions.clear();this.memberExecutions.clear();await Promise.all([...this.controlledFileServices.values()].map(x=>x.close()));this.controlledFileServices.clear();await Promise.all([...this.isolatedExecutionServices.values()].map(x=>x.close()));this.isolatedExecutionServices.clear();await this.platform.controlledFiles?.close();await Promise.all([...this.running.values()].map(w=>w.prepareClose()));await Promise.all([...this.dispatchers.values()].map(x=>x.close()));this.dispatchers.clear();this.memberRegistries.clear();this.ownershipRegistries.clear();for(const monitor of this.monitors.values())monitor.close();await Promise.all([...this.histories.values()].map(x=>x.close()));this.histories.clear();this.monitors.clear();const results=await Promise.allSettled([...this.running.values()].map(w=>w.close()));await this.resources.close();this.running.clear();const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason})();void this.shutdownPromise.catch(error=>{if(['CONTROLLED_FILE_DRAIN_PENDING','EXECUTION_SCOPE_DRAIN_PENDING'].includes(error?.code))this.shutdownPromise=undefined});return this.shutdownPromise}
  /** 默认选择转为独立引擎及明确模型身份，校验协议后仅向调度层返回公开标识；工作区工厂随后取得运行快照，兼容 CLI 显式模型。 */
  async modelOptions(input:any={}){
    if(input?.provider&&input?.model&&!input.profileId)return input;
    const {profile}=await this.models.resolve(input?.profileId,input?.model,input?.engine);

    return {...input,engine:profile.engine??'pi',provider:'cbim-'+profile.id,model:profile.model,profileId:profile.id};
  }
  /** 发送前验证图片能力；队列只保存工作区快照 ID，启动时再检查当前模型。 */
  async chatOptions(id:string,input:any,attachments:unknown){
    if(!input?.profileId&&!input?.provider&&!input?.model&&!input?.engine){
      const workspace=this.workspace(id),setting=await this.mainAgentSettings.read({workspaceId:id,instanceId:workspace.instanceId});
      if(setting.selection)input={...input,engine:setting.selection.engine,profileId:setting.selection.profileId,model:setting.selection.modelId};
    }
    const options=await this.modelOptions(input);
    const images=await new ChatInputs(this.workspace(id)).images(attachments);
    if(images.length&&options.profileId&&!(await this.models.resolve(options.profileId,options.model)).profile.vision)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    return {...options,attachmentIds:attachments??[]};
  }
  /** 所有 IPC 操作通过独立路由，调用方仍需显式传入工作区身份。 */
  dispatch<A extends IpcAction>(action:A,args?:unknown):Promise<IpcResponse<A>>;
  dispatch(action:string,args?:unknown):Promise<unknown>;
  dispatch(action:string,args:unknown={}){return dispatchApplication(this,action,args)}

}
