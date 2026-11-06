/**
 * 作用定位：管理本机工作区的身份、独占锁、知识监听和维护任务。
 * 设计原因：知识操作委托 KnowledgeStore 保持事务边界；工作区统一打开关闭顺序，供应用内部执行和调度使用。维护任务按实例隔离，取消不存在的任务明确报错，不能把对话任务误报为已取消。
 */
import fs from 'node:fs/promises';
import {FileObjectStorage} from '../persistence/knowledge/object-storage';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Paths} from '../platform/paths';
import {atomic,exists,readJson} from '../../core/foundation/files';
import {json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {KernelLock} from '../platform/locking';
import {Rules} from '../../core/knowledge/knowledge';
import {KnowledgeStore} from '../persistence/knowledge/knowledge-store';
import type {WorkspaceEntry,WorkspaceView,Snapshot,ChangeRequest,TaskView} from '../../../bridge/contracts/workspace';
export class Workspace implements KnowledgeWorkspace {
  readonly objects:FileObjectStorage;
  /** 每次打开生成新身份，拒绝重启前的旧请求和预览。 */
  readonly instanceId=randomUUID();knowledgeErrors=0;
  state='registered';error?:string;changed=false;lastRevision='';
  readonly tasks=new Map<string,TaskView>();private controllers=new Map<string,AbortController>();
  private lock?:KernelLock;private watcher?:NodeJS.Timeout;private polling=false;
  private readonly knowledge:KnowledgeStore;
  // Fault injection is an explicit dependency used only by isolated tests.
  constructor(readonly entry:WorkspaceEntry,readonly paths:Paths,readonly rules:Rules,readonly fault?:(step:number)=>void){this.objects=new FileObjectStorage(this);this.knowledge=new KnowledgeStore(this,(event,details)=>this.log(event,details))}
  view():WorkspaceView{return {...this.entry,state:this.state,error:this.error,tasks:[...this.tasks.values()],revision:this.lastRevision,changed:this.changed,instanceId:this.instanceId,knowledgeErrors:this.knowledgeErrors}}
  assert(identity?:{workspaceId:string;instanceId:string}){if(this.state!=='running')fail('NOT_RUNNING',`工作区当前状态：${this.state}`);if(identity&&(identity.workspaceId!==this.entry.id||identity.instanceId!==this.instanceId))fail('STALE_INSTANCE','工程或运行实例身份不匹配，请刷新工作区状态')}
  /** 持有独占锁后恢复事务并初始化知识；失败释放锁，不发布网络端点或写入外部工具配置。 */
  async open(){
    if(this.state==='running')return;this.state='opening';
    try{
      const identity=await this.paths.identity(this.entry.path);if(identity.id!==this.entry.id)fail('IDENTITY','工程真实路径已变化，需要重新定位');
      this.lock=new KernelLock(identity.path,identity.id);
      const mapping=path.join(this.paths.project(identity.id),'identity.json');if(await exists(mapping)&&(await readJson(mapping)).path!==identity.path)fail('IDENTITY','本地历史记录绑定的工程不匹配');await atomic(mapping,json(identity));
      await this.knowledge.recover();await this.knowledge.initialize();
      const snapshot=await this.read();this.lastRevision=snapshot.revision;
      const validation=await this.rules.validate(this.entry.path,snapshot.files);this.knowledgeErrors=validation.issues.filter(i=>i.severity==='error').length;
      this.state='running';
      await this.log('opened');
      this.watcher=setInterval(()=>{if(this.polling||this.state!=='running'||this.knowledge.activeOperations)return;this.polling=true;void this.read().then(s=>{if(s.revision!==this.lastRevision){this.changed=true;this.lastRevision=s.revision}}).catch(e=>{this.error=e.message}).finally(()=>{this.polling=false})},1200);this.watcher.unref();
    }catch(e:any){this.error=e.message;this.state='failed';this.lock?.close();this.lock=undefined;throw e}
  }
  /** 存储操作统一委托，工作区仍负责实例身份和生命周期。 */
  read(){return this.knowledge.read()}
  snapshot(){return this.knowledge.snapshot()}
  preview(request:ChangeRequest){return this.knowledge.preview(request)}
  commit(request:ChangeRequest){return this.knowledge.commit(request)}
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
  async close(){if(this.state==='closed')return;this.state='closing';if(this.watcher)clearInterval(this.watcher);for(const c of this.controllers.values())c.abort();await this.knowledge.drain();while(this.controllers.size)await new Promise(r=>setTimeout(r,10));this.lock?.close();this.lock=undefined;this.state='closed';await this.log('closed')}
}
