/**
 * 作用定位：调度引擎：工作区执行管理，负责主 Agent 普通对话、团队任务执行与多轮历史读取，拒绝旧轮次分叉，挂起并处理逐次工具审批与结构化用户问题，持久化消息队列并在成功结束后串行续接；本次全部通过仅在当前执行期间有效。
 * 设计原因：编辑、拖动和原生插入按会话串行，插入失败暂停队列等待核实；保留每轮附件身份，避免续聊或排队丢图；仅依赖 Core 契约和注入工厂；配置仅传递供应商身份和模型 ID，凭据由工厂注入；关闭工作区时先排空执行。
 */
import {MessageQueue} from '../conversation/message-queue';
import {ApprovalQueue} from '../conversation/approvals';
import {QuestionQueue} from '../conversation/questions';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mainAgentId} from '../conversation/main-agent';
import {z} from 'zod';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail} from '../../core/foundation/errors';
import {safeId} from '../../core/foundation/identity';
import type {RunStorage} from '../../core/brain/storage';
import type {StoredEvent,TaskSpec} from '../../core/brain';
import type {createWorkspaceLoop,WorkspaceLoopOptions} from './loop-engine';
import {prepareTeamTask,type TeamTaskInput} from '../context/team-workflow';
import {Team} from '../../core/team/model';
import {BusinessWorkspace} from '../../core/workspace/model';

/** IPC 允许的模型运行配置；不接受任意子进程命令或环境变量。 */
export const executionOptions=z.object({provider:z.string().trim().min(1),model:z.string().trim().min(1),profileId:z.string().uuid().optional(),attachmentIds:z.array(z.string().uuid()).max(12).optional(),allowNativeExecution:z.boolean().default(false),permission:z.enum(['read','ask','execute']).optional(),turnTimeoutMs:z.number().int().min(1000).max(3600000).optional()}).strict();
type Options=z.infer<typeof executionOptions>;
export class WorkspaceExecutionManager {
  private messageQueue?:MessageQueue;
  private async queue(){const q=this.messageQueue??=new MessageQueue(path.join(this.workspace.paths.project(this.workspace.entry.id),'loop-engine','pending-messages.json'));await q.load();return q}
  queued(taskId:string){return this.serial(async()=>{safeId(taskId);return (await this.queue()).list(taskId)})}
  /** 队列游标与变更共享串行边界，只发布已提交快照；保留 queued 供兼容和诊断使用。 */
  queueDelta(taskId:string,cursor?:unknown){return this.serial(async()=>{safeId(taskId);return (await this.queue()).delta(taskId,cursor)})}
  enqueue(taskId:string,message:string,options:Options){return this.serial(async()=>{safeId(taskId);if(!message.trim())throw Error('消息不能为空');await this.thread(taskId);const q=await this.queue();const entry=await q.add(taskId,message,executionOptions.parse(options));await this.pump(taskId);return entry})}
  changeQueued(taskId:string,id:string,action:unknown){return this.serial(async()=>{await (await this.queue()).change(taskId,id,z.enum(['first','up','down','remove']).parse(action))})}
  editQueued(taskId:string,id:string,message:string,expected:string){return this.serial(async()=>{await (await this.queue()).edit(taskId,id,message,expected)})}
  moveQueued(taskId:string,id:string,beforeId?:string){return this.serial(async()=>{await (await this.queue()).move(taskId,id,beforeId)})}
  /** 插入使用活动运行的模型和权限；先保存占用，失败暂停保留，绝不自动重放。 */
  insertQueued(taskId:string,id:string){return this.serial(async()=>{
    const active=this.active.get(taskId);if(!active)throw Error('当前任务已结束，请继续队列');
    const q=await this.queue(),entry=await q.claim(taskId,id);
    try{const images=await this.inputImages(entry.options.attachmentIds);await active.loop.runtime.steer(taskId,entry.message,images);await q.complete(id)}
    catch(error:any){await q.pause(taskId,'插入未确认：'+error.message+'；请核实当前对话后再继续队列');throw error}
  })}
  continueQueue(taskId:string){return this.serial(async()=>{safeId(taskId);await (await this.queue()).resume(taskId);await this.pump(taskId)})}
  /** 成功结束才自动续接；异常和未核实工具保留队列，等待用户显式处理。 */
  private async pump(taskId:string){
    if(this.closing||this.active.has(taskId))return;const q=await this.queue();if(!q.list(taskId).length)return;
    const prior=(await this.thread(taskId)).at(-1);if(!prior?.sessionFile||prior.unresolvedTools.length||prior.status==='interrupted'||prior.status==='running'){await q.pause(taskId,'请先核实上一轮执行状态');return}
    if(prior.task.mode!=='chat'){await q.pause(taskId,'队列仅支持普通对话');return}
    const next=await q.take(taskId);if(!next)return;
    try{await this.launch(prior.task,executionOptions.parse(next.options),next.message,{runId:prior.runId});await q.complete(next.id)}catch(e:any){await q.pause(taskId,e.message)}
  }
  private active=new Map<string,{runId:string;loop:Awaited<ReturnType<typeof createWorkspaceLoop>>}>();
  private pending:Promise<unknown>=Promise.resolve();
  private closing=false;
  private listeners=new Set<(event:StoredEvent)=>void>();
  private questions=new QuestionQueue();
  pendingQuestions(taskId:string){safeId(taskId);return this.questions.list(taskId)}
  answerQuestion(taskId:string,id:string,answers:unknown){safeId(taskId);this.questions.answer(taskId,id,answers)}
  private approvalQueue=new ApprovalQueue();
  pendingApprovals(taskId:string){safeId(taskId);return this.approvalQueue.list(taskId)}
  answerApproval(taskId:string,id:string,allow:boolean,allowAll=false){this.approvalQueue.answer(taskId,id,allow,allowAll)}
  private cancelApprovals(taskId?:string){this.approvalQueue.cancel(taskId);this.questions.cancel(taskId)}
  /** 运行工厂由装配方注入，调度层不创建 main 的进程锁或具体工作区实例。 */
  constructor(readonly workspace:KnowledgeWorkspace,private storage:RunStorage,private factory:(options:WorkspaceLoopOptions)=>ReturnType<typeof createWorkspaceLoop>,private inputImages:(ids?:string[])=>Promise<import('../../core/brain/types').InputImage[]>=async()=>[]){}
  /** 观察者只收到已落盘事件；监听错误不能改变执行结果。 */
  subscribe(listener:(event:StoredEvent)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  private serial<T>(work:()=>Promise<T>):Promise<T>{
    if(this.closing)return Promise.reject(Error('工作区执行管理正在关闭'));
    const next=this.pending.then(()=>{this.workspace.assert();return work()});this.pending=next.catch(()=>{});return next;
  }
  prepare(input:TeamTaskInput){return this.serial(()=>prepareTeamTask(this.workspace,input))}
  /** 对话选择器只返回标识和摘要；完整知识在启动时由准备流程重新校验并冻结。 */
  async choices(){
    const snapshot=await this.workspace.snapshot(),business=new BusinessWorkspace(snapshot),team=new Team(snapshot);
    const registry=await business.modules(),agents=await team.agents(),people=await team.people();
    const modules=await Promise.all(registry.modules.map(async(m:any)=>{const detail=await business.module(m.id);return {id:m.id,name:detail.definition.name,workflows:detail.workflows.map((w:any)=>({id:w.id,name:w.name}))}}));
    return {modules,agents:agents.groups.flatMap((g:any)=>g.agents.map((a:any)=>({id:a.id,name:a.name}))),people:people.people.map((p:any)=>({id:p.id,name:p.name||p.id})),structural:snapshot.validation?.structural};
  }
  /** 获取一个任务的完整对话轮次；不改变执行状态，跨工作区身份仍由 inspect 校验。 */
  async thread(taskId:string){
    const root=path.join(this.directory(),safeId(taskId));const runs=await this.storage.list(root);
    const summaries=await Promise.all(runs.map(runId=>this.inspect(taskId,safeId(runId))));
    return summaries.sort((a,b)=>a.events[0].time.localeCompare(b.events[0].time));
  }
  /** 新任务重新准备上下文，不接收调用方伪造的知识正文或任务身份。 */
  start(input:TeamTaskInput,options:Options){return this.serial(async()=>this.launch(await prepareTeamTask(this.workspace,input),executionOptions.parse(options)))}
  /** 普通对话由内置主 Agent 接待，不依赖团队注册表或知识结构通过校验。 */
  chat(message:string,options:Options){return this.serial(async()=>{
    const goal=z.string().trim().min(1).parse(message);
    return this.launch({mode:'chat',taskId:randomUUID(),workspaceId:this.workspace.entry.id,root:this.workspace.entry.path,goal,agentId:mainAgentId,moduleIds:[],acceptance:[]},executionOptions.parse(options));
  })}
  private async launch(task:TaskSpec,options:Options,message=task.goal,resume?:{runId:string;reconciledToolIds?:string[]}){
    if(this.active.has(task.taskId))fail('TASK_RUNNING','任务正在执行');
    const loop=await this.factory({...options,allowNativeExecution:options.permission?options.permission!=='read':options.allowNativeExecution,mode:task.mode,requestQuestion:(args,signal)=>this.questions.ask(task.taskId,args,signal),requestApproval:call=>this.approvalQueue.request(task.taskId,call),onEvent:event=>{for(const listener of this.listeners)try{listener(event)}catch{/* observers are not transactions */}}});
    try{
      const run=await loop.runtime.start(task,message,resume);
      this.active.set(task.taskId,{runId:run.runId,loop});
      void run.done.catch(()=>undefined).then(async summary=>{this.cancelApprovals(task.taskId);await loop.runtime.close();if(this.active.get(task.taskId)?.runId===run.runId)this.active.delete(task.taskId);if(!this.closing)await this.serial(async()=>{if(summary?.status==='completed')await this.pump(task.taskId);else await (await this.queue()).pause(task.taskId,'上一轮已停止或失败，请确认后继续队列')})}).catch(()=>{});
      return {workspaceId:task.workspaceId,taskId:task.taskId,runId:run.runId};
    }catch(error){await loop.runtime.close();throw error}
  }
  /** 从持久化身份恢复；普通对话按需读取知识，团队任务仍要求冻结知识版本一致。 */
  resume(taskId:string,runId:string,message:string,options:Options,reconciledToolIds:string[]=[]){return this.serial(async()=>{
    if(!message?.trim())fail('MESSAGE','恢复说明不能为空');
    const prior=await this.inspect(taskId,runId);
    const history=await this.thread(taskId);if(history.at(-1)?.runId!==runId)fail('STALE_RUN','已有更新的对话轮次，请刷新后继续');
    if(prior.task.mode!=='chat'){
      if(!prior.task.workflowContext)fail('TASK_CONTEXT','旧任务缺少团队工作流上下文，请新建团队任务');
      if((await this.workspace.read()).revision!==prior.task.workflowContext.revision)fail('CONFLICT','知识版本已变化，请核对后创建新任务');
    }
    return this.launch(prior.task,executionOptions.parse(options),message,{runId,reconciledToolIds});
  })}
  async stop(taskId:string){safeId(taskId);await this.serial(async()=>{await (await this.queue()).pause(taskId,'已暂停，请点击继续队列')});this.cancelApprovals(taskId);await this.active.get(taskId)?.loop.runtime.stop(taskId)}
  private directory(){return path.join(this.workspace.paths.project(this.workspace.entry.id),'loop-engine','tasks')}
  async inspect(taskId:string,runId:string){
    const active=this.active.get(taskId);
    const result=active?.runId===runId?await active.loop.runtime.inspect(taskId,runId):await this.storage.read(path.join(this.directory(),safeId(taskId),safeId(runId)));
    if(result.task.workspaceId!==this.workspace.entry.id||result.task.root!==this.workspace.entry.path)fail('IDENTITY','执行记录属于其他工作区');
    return result;
  }
  /** 历史从日志读取，重启后仍可查看；损坏日志返回错误，不伪装成完成。 */
  async list(){
    let tasks:string[];try{tasks=await this.storage.list(this.directory())}catch(e:any){if(e.code==='ENOENT')return [];throw e}
    const records=[];
    for(const taskId of tasks)for(const runId of await this.storage.list(path.join(this.directory(),safeId(taskId)))){
      try{const {events,...summary}=await this.inspect(taskId,runId);records.push({...summary,eventCount:events.length})}
      catch(e:any){records.push({taskId,runId,status:'unreadable',error:e.message})}
    }
    return records;
  }
  /** 禁止新任务，等待启动登记完成，然后停止并排空所有运行。 */
  async close(){this.closing=true;await this.pending;this.cancelApprovals();await Promise.all([...this.active.values()].map(x=>x.loop.runtime.close()));this.active.clear();this.listeners.clear()}
}
