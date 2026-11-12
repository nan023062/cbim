/**
 * 作用定位：管理本机工作区的身份、独占锁、知识监听和维护任务。
 * 设计原因：知识操作委托 KnowledgeStore 保持事务边界；工作区统一打开关闭顺序，供应用内部执行和调度使用。维护任务按实例隔离，取消不存在的任务明确报错，不能把对话任务误报为已取消。
 * 回执边界：当前实例可只读核实旧请求的原 journal；同一 DispatchStore 在持工程锁、核路径并完成可信历史初始化阶段后加载，再核来源 journal 与治理。关闭先排空知识和来源结算再关闭 Store，不恢复旧实施意图。
 */
import fs from 'node:fs/promises';
import {FileObjectStorage} from '../knowledge/object-storage';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Paths} from '../platform/paths';
import {atomic,exists,readJson} from '../../core/foundation/files';
import {json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {KernelLock} from '../platform/locking';
import {Rules} from '../../core/knowledge/knowledge';
import {KnowledgeStore} from '../knowledge/knowledge-store';
import {ModuleGovernanceService} from '../governance/module-governance';
import {FileDispatchStore} from '../dispatch-storage/dispatch-store';
import {KnowledgeSources} from '../registry/knowledge-sources';
import type {KnowledgePlanRef} from '../../core/knowledge/planned-commit';
import type {KnowledgeGovernanceTransaction} from '../knowledge/governance-port';
import type {WorkspaceEntry,WorkspaceView,Snapshot,ChangeRequest,TaskView} from '../../../bridge/contracts/workspace';
export class Workspace implements KnowledgeWorkspace {
  readonly objects:FileObjectStorage;
  readonly governance:ModuleGovernanceService;
  /** 每次打开生成新身份，拒绝重启前的旧请求和预览。 */
  readonly instanceId=randomUUID();knowledgeErrors=0;
  state='registered';error?:string;changed=false;lastRevision='';
  readonly tasks=new Map<string,TaskView>();private controllers=new Map<string,AbortController>();
  private lock?:KernelLock;private watcher?:NodeJS.Timeout;private polling=false;
  private readonly knowledge:KnowledgeStore;
  private closePreparation?:Promise<void>;
  /** 与岗位、责任及执行服务共用；仅在持工程锁后加载，不能创建恢复专用第二实例。 */
  private sharedDispatch?:FileDispatchStore;
  sources?:KnowledgeSources;
  // Fault injection is an explicit dependency used only by isolated tests.
  constructor(readonly entry:WorkspaceEntry,readonly paths:Paths,readonly rules:Rules,readonly fault?:(step:number)=>void){this.objects=new FileObjectStorage(this);this.governance=new ModuleGovernanceService(this,path.join(paths.project(entry.id),'governance','module-ledger.json'));this.knowledge=new KnowledgeStore(this,(event,details)=>this.log(event,details),this.governance)}
  view():WorkspaceView{return {...this.entry,state:this.state,error:this.error,tasks:[...this.tasks.values()],revision:this.lastRevision,changed:this.changed,instanceId:this.instanceId,knowledgeErrors:this.knowledgeErrors}}
  /** 区分工程选错与运行实例变化；只提示刷新身份，不重绑定旧计划或重放未知写入。 */
  assert(identity?:{workspaceId:string;instanceId:string}){
    if(this.state!=='running')fail('NOT_RUNNING',`工作区当前状态：${this.state}`);
    if(identity&&identity.workspaceId!==this.entry.id)fail('STALE_INSTANCE','工程身份不匹配。请用 cbim_workspace_identity 核对当前 workspaceId，再选择正确工程；不能把其他工程的请求改绑到这里。');
    if(identity&&identity.instanceId!==this.instanceId)fail('STALE_INSTANCE',`运行实例已变化，可能已重启。请调用 cbim_workspace_identity，使用新 instanceId（当前为 ${this.instanceId}）重新读取与预览。未知提交先核实原回执，不自动重放。`);
  }
  /** Application 可在 open 前注入带监控器的唯一 Store；此时不读取磁盘。 */
  attachDispatchStore(store:FileDispatchStore){if(this.sharedDispatch&&this.sharedDispatch!==store)fail('SOURCE_UNAVAILABLE','工作区已有派发存储');if(store.workspaceId!==this.entry.id)fail('SOURCE_UNAVAILABLE','派发存储工作区不匹配');this.sharedDispatch=store;this.sources??=new KnowledgeSources(this.entry.id,store);this.knowledge.attachSources(this.sources)}
  get dispatchStore(){if(!this.sharedDispatch)fail('SOURCE_UNAVAILABLE','工作区来源存储尚未打开');return this.sharedDispatch}
  /**
   * 持有独占锁后恢复事务并初始化知识；失败释放锁，不发布网络端点或写入外部工具配置。
   * beforeDispatchLoad 是 Main 装配方的可信启动阶段：路径归属核实后、Store 首次读取或恢复提交前，先恢复观察器需要的历史索引。
   * 此回调不来自 IPC 或模型，不应读取或提交同一 Store；阶段失败沿打开失败路径封闭实例，不继续恢复事务。
   */
  async open(hooks:{beforeDispatchLoad?:()=>Promise<void>}={}){
    if(this.state==='running')return;this.state='opening';
    try{
      const identity=await this.paths.identity(this.entry.path);if(identity.id!==this.entry.id)fail('IDENTITY','工程真实路径已变化，需要重新定位');
      this.lock=new KernelLock(identity.path,identity.id);
      if(!this.sharedDispatch)this.attachDispatchStore(new FileDispatchStore(path.join(this.paths.project(this.entry.id),'dispatch'),this.entry.id));
      const mapping=path.join(this.paths.project(identity.id),'identity.json');if(await exists(mapping)&&(await readJson(mapping)).path!==identity.path)fail('IDENTITY','本地历史记录绑定的工程不匹配');await atomic(mapping,json(identity));
      // 先核实项目路径归属，再允许 Store 修复其自身末尾记录；身份不符不得触碰旧调度历史。
      await hooks.beforeDispatchLoad?.();
      await this.dispatchStore.read();
      await this.governance.init();await this.knowledge.recover();await this.knowledge.initialize();
      const snapshot=await this.read();this.lastRevision=snapshot.revision;
      const validation=await this.rules.validate(this.entry.path,snapshot.files);this.knowledgeErrors=validation.issues.filter(i=>i.severity==='error').length;
      this.state='running';
      await this.governance.validatePersisted();
      await this.log('opened');
      this.watcher=setInterval(()=>{if(this.polling||this.state!=='running'||this.knowledge.activeOperations)return;this.polling=true;void this.read().then(s=>{if(s.revision!==this.lastRevision){this.changed=true;this.lastRevision=s.revision}}).catch(e=>{this.error=e.message}).finally(()=>{this.polling=false})},1200);this.watcher.unref();
    }catch(e:any){this.error=e.message;this.state='failed';await this.sharedDispatch?.close().catch(()=>{});this.lock?.close();this.lock=undefined;throw e}
  }
  /** 存储操作统一委托，工作区仍负责实例身份和生命周期。 */
  read(){return this.knowledge.read()}
  snapshot(){return this.knowledge.snapshot()}
  preview(request:ChangeRequest){return this.knowledge.preview(request)}
  commit(request:ChangeRequest){return this.knowledge.commit(request)}
  commitPlanned(reference:KnowledgePlanRef){return this.knowledge.commitPlanned(reference)}
  /** 原成功回执先由服务查询；新的来源采纳才持此知识观察锁进入一个 Store 事务。 */
  withSourceSnapshot<T>(operation:(snapshot:Snapshot)=>Promise<T>){return this.knowledge.withSourceSnapshot(operation)}
  /** Main 私有治理端口；回调已经持有知识队列，不可重入公开提交方法。 */
  governed<T>(operation:(tx:KnowledgeGovernanceTransaction)=>Promise<T>){return this.knowledge.governed(operation)}
  /** 查询原知识事务回执；旧实例请求可核实，但不会被重新提交。 */
  committedReceipt(request:ChangeRequest){return this.knowledge.committedReceipt(request)}
  /** 未受理核实只看原事务记录是否存在，不把回滚或未完成记录当作不存在。 */
  hasRecordedRequest(request:ChangeRequest){return this.knowledge.hasRecordedRequest(request)}
  planMove(snapshot:Snapshot,from:string,to:string|null){return this.knowledge.planMove(snapshot,from,to)}
  startTask(name:'validate'|'reindex'){
    this.assert();const id=randomUUID(),controller=new AbortController();this.controllers.set(id,controller);const task:TaskView={id,workspaceId:this.entry.id,name,state:'running',progress:'读取知识并检查规则'};this.tasks.set(id,task);
    void (async()=>{try{await new Promise(r=>setTimeout(r,0));if(controller.signal.aborted)fail('CANCELLED','任务已取消');const snap=await this.snapshot();if(controller.signal.aborted)fail('CANCELLED','任务已取消');if(name==='reindex'){task.progress='提交索引；此阶段等待完成后关闭';task.result=await this.commit({workspaceId:this.entry.id,instanceId:this.instanceId,revision:snap.revision,requestId:id,changes:[]})}else task.result=snap.validation;task.state='completed';task.progress='检查结束：架构判断仍需团队 review'}catch(e:any){task.state=e.code==='CANCELLED'?'cancelled':'failed';task.error=e.message}finally{this.controllers.delete(id);await atomic(path.join(this.paths.local(this.entry.id,'task-records'),id+'.json'),json(task)).catch(()=>{})}})();return task;
  }
  /**
   * 仅取消本实例的知识检查或索引维护任务；对话和成员派发任务不在此任务表中。
   * 未运行或不存在时抛出明确错误。返回当前真实状态：abort 只是取消请求，已进入提交的事务可继续完成；终态重复取消保持原结果。
   */
  cancelTask(id:string):TaskView{
    this.assert();const task=this.tasks.get(id);
    if(!task||task.workspaceId!==this.entry.id)fail('TASK_NOT_FOUND','当前工作区实例中不存在该维护任务；此接口仅支持知识检查或索引维护任务，不接受对话或成员派发任务 ID');
    if(task.state==='running')this.controllers.get(id)?.abort();
    return task;
  }
  async localData(kind:'memory'|'task-records'|'logs'){const dir=this.paths.local(this.entry.id,kind);await fs.mkdir(dir,{recursive:true});return {source:'local',nature:kind,workspaceId:this.entry.id,files:await fs.readdir(dir)}}
  private async log(event:string,details:Record<string,unknown>={}){const directory=this.paths.local(this.entry.id,'logs');await fs.mkdir(directory,{recursive:true});await fs.appendFile(path.join(directory,'events.ndjson'),JSON.stringify({time:new Date().toISOString(),workspaceId:this.entry.id,instanceId:this.instanceId,event,...details})+'\n',{mode:0o600}).catch(()=>{})}
  /** 停止监听与任务，等待正在提交的事务，再释放本实例持有的锁。 */
  async prepareClose(){return this.closePreparation??= (async()=>{if(this.state==='closed')return;this.state='closing';if(this.watcher)clearInterval(this.watcher);for(const c of this.controllers.values())c.abort();await this.knowledge.drain();while(this.controllers.size)await new Promise(r=>setTimeout(r,10))})()}
  async close(){if(this.state==='closed')return;await this.prepareClose();await this.sharedDispatch?.close();this.lock?.close();this.lock=undefined;this.state='closed';await this.log('closed')}
}
