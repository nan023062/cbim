/**
 * 作用定位：本机工作区实例：身份、锁、监听、维护任务及可选传输生命周期。
 * 设计原因：知识操作委托 KnowledgeStore 保持事务边界；工作区负责打开关闭顺序，支持不发布 MCP 的内部服务模式。 维护任务按实例隔离，取消不存在的任务明确报错，不能把对话任务误报为已取消。
 */
import fs from 'node:fs/promises';
import {FileObjectStorage} from '../persistence/knowledge/object-storage';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Paths} from '../platform/paths';
import {atomic,exists,readJson} from '../../core/foundation/files';
import {json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {KernelLock} from '../platform/locking';
import {McpMonitor} from '../integrations/mcp/mcp-status';
import {McpCallLogs} from '../integrations/mcp/mcp-log';
import {Rules} from '../../core/knowledge/knowledge';
import {KnowledgeStore} from '../persistence/knowledge/knowledge-store';
import type {WorkspaceEntry,WorkspaceView,Snapshot,ChangeRequest,TaskView} from '../../../bridge/contracts/workspace';
export class Workspace implements KnowledgeWorkspace {
  readonly objects:FileObjectStorage;
  readonly instanceId=randomUUID();readonly readToken=randomBytes(32).toString('hex');readonly writeToken=randomBytes(32).toString('hex');
  readonly mcp=new McpMonitor(this.instanceId);readonly calls:McpCallLogs;knowledgeErrors=0;
  state='registered';error?:string;hostConfigWarnings:string[]=[];writable=false;changed=false;lastRevision='';
  readonly tasks=new Map<string,TaskView>();private controllers=new Map<string,AbortController>();
  private lock?:KernelLock;private watcher?:NodeJS.Timeout;private polling=false;
  private closeTransport?:()=>Promise<void>;private readonly knowledge:KnowledgeStore;
  // Fault injection is an explicit dependency used only by isolated tests.
  constructor(readonly entry:WorkspaceEntry,readonly paths:Paths,readonly rules:Rules,readonly fault?:(step:number)=>void){this.objects=new FileObjectStorage(this);this.knowledge=new KnowledgeStore(this,(event,details)=>this.log(event,details));this.calls=new McpCallLogs(path.join(paths.local(entry.id,'logs'),'mcp-calls.ndjson'),entry.id)}
  view():WorkspaceView{return {...this.entry,state:this.state,error:this.error,hostConfigWarnings:this.hostConfigWarnings,writable:this.writable,tasks:[...this.tasks.values()],revision:this.lastRevision,changed:this.changed,instanceId:this.instanceId,mcp:this.mcp.view(),knowledgeErrors:this.knowledgeErrors}}
  assert(identity?:{workspaceId:string;instanceId:string}){if(this.state!=='running')fail('NOT_RUNNING',`工作区当前状态：${this.state}`);if(identity&&(identity.workspaceId!==this.entry.id||identity.instanceId!==this.instanceId))fail('STALE_INSTANCE','工程或运行实例身份不匹配，请重新发现并连接')}
  /** 持有锁后初始化知识；外部 MCP 可选，内部执行不依赖传输服务。 */
  async open(start?: (workspace:Workspace)=>Promise<{url:string;close:()=>Promise<void>;probe:()=>Promise<void>}>){
    if(this.state==='running')return;this.state='opening';
    try{
      const identity=await this.paths.identity(this.entry.path);if(identity.id!==this.entry.id)fail('IDENTITY','工程真实路径已变化，需要重新定位');
      this.lock=new KernelLock(identity.path,identity.id);
      const mapping=path.join(this.paths.project(identity.id),'identity.json');if(await exists(mapping)&&(await readJson(mapping)).path!==identity.path)fail('IDENTITY','本地历史记录绑定的工程不匹配');await atomic(mapping,json(identity));
      await this.calls.init();await this.knowledge.recover();await this.knowledge.initialize();
      const snapshot=await this.read();this.lastRevision=snapshot.revision;
      const validation=await this.rules.validate(this.entry.path,snapshot.files);this.knowledgeErrors=validation.issues.filter(i=>i.severity==='error').length;
      this.state='running';if(start){const transport=await start(this);this.closeTransport=transport.close;await transport.probe();
      await atomic(path.join(this.paths.project(this.entry.id),'credentials.json'),json({workspaceId:this.entry.id,instanceId:this.instanceId,readToken:this.readToken,writeToken:this.writeToken}));
      await atomic(this.paths.discovery(this.entry.id),json({version:1,protocol:'mcp-streamable-http',workspaceId:this.entry.id,root:this.entry.path,instanceId:this.instanceId,pid:process.pid,url:transport.url,createdAt:new Date().toISOString(),credentialFile:'credentials.json'}));}
      await this.log('opened');
      this.watcher=setInterval(()=>{if(this.polling||this.state!=='running'||this.knowledge.activeOperations)return;this.polling=true;void this.read().then(s=>{if(s.revision!==this.lastRevision){this.changed=true;this.lastRevision=s.revision}}).catch(e=>{this.error=e.message}).finally(()=>{this.polling=false})},1200);this.watcher.unref();
    }catch(e:any){this.error=e.message;this.state='failed';this.mcp.checked(0,e.message);await this.closeTransport?.();await this.calls.flush();await this.clearDiscovery();this.lock?.close();this.lock=undefined;throw e}
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
  private async clearDiscovery(){for(const p of [this.paths.discovery(this.entry.id),path.join(this.paths.project(this.entry.id),'credentials.json')])if(await exists(p)){try{const d=await readJson(p);if(d.instanceId===this.instanceId)await fs.rm(p,{force:true})}catch{}}}
  /** 停止监听与任务，等待正在提交的事务，关闭传输并释放本实例持有的锁。 */
  async close(){if(this.state==='closed')return;this.mcp.stopped();this.state='closing';if(this.watcher)clearInterval(this.watcher);for(const c of this.controllers.values())c.abort();await this.knowledge.drain();while(this.controllers.size)await new Promise(r=>setTimeout(r,10));await this.closeTransport?.();await this.clearDiscovery();this.lock?.close();this.lock=undefined;this.state='closed';this.writable=false;await this.log('closed')}
}
