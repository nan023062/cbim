/**
 * 作用定位：单次运行授权、版本化队列增量和结构化问题按工作区路由；排队时冻结附件内容与模型身份。Application：登记及重命名工作区、装配模型供应商与服务，并统一派发主 Agent 对话、附件快照、工具审批和历史操作。
 * 设计原因：全应用只有一个动态运行监管入口，聚合各工作区的成员、任务和用量；实例装配时恢复一次基线，之后接收提交事实。工作区退役先阻止新服务，再排空服务、监控与锁；页面切换不影响执行。
 */
import path from 'node:path';
import {dispatchApplication} from './ipc/dispatch';
import type {ApplicationServices} from './ipc/services';
import {LlmProfiles,type SecretCipher} from './persistence/settings/llm-profiles';
import {createExecutionManager} from './execution';
import {createMemberDispatch} from './member-dispatch';
import type {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import {GlobalRuntimeManager} from '../scheduler-engine/runtime/global-runtime';
import {WorkspaceRuntimeMonitor} from './runtime-monitor';
import {ChatInputs} from './persistence/tasks/chat-inputs';
import type {WorkspaceExecutionManager} from '../scheduler-engine/execution/execution-manager';
import {Catalog} from './workspace/catalog';
import {Paths} from './platform/paths';
import {exists} from '../core/foundation/files';
import {fail} from '../core/foundation/errors';
import {Rules} from '../core/knowledge/knowledge';
import {Workspace} from './workspace/workspace';
import {ResourceRepositories} from './resources/resource-repository';
/** 实现路由所需的服务契约；IPC 层不反向依赖本应用类。 */
export class Application implements ApplicationServices {
  readonly catalog:Catalog;readonly rules:Rules;readonly running=new Map<string,Workspace>();private opening=new Map<string,Promise<Workspace>>();
  readonly resources:ResourceRepositories;
  /** 全应用共享供应商目录；公开 IPC 不返回凭据，运行时才解密。 */
  readonly models:LlmProfiles;
  private executions=new Map<string,WorkspaceExecutionManager>();
  private dispatchers=new Map<string,WorkspaceDispatchService>();
  /** 应用级唯一监管投影；底层权威日志与执行权限仍归各工作区所有。 */
  readonly runtime=new GlobalRuntimeManager();
  private monitors=new Map<string,WorkspaceRuntimeMonitor>();
  /** 关闭/重启跨 await 期间阻止新服务进入；计数允许 stop 等待一个正在重启的 open。 */
  private retiring=new Map<string,number>();
  private retire(id:string){this.retiring.set(id,(this.retiring.get(id)??0)+1);return ()=>{const count=this.retiring.get(id)!-1;if(count)this.retiring.set(id,count);else this.retiring.delete(id)}}
  private assertServiceAvailable(id:string){if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');if(this.retiring.has(id))fail('WORKSPACE_STOPPING','工作区正在关闭或重启，请稍后重试')}
  /** 成员图与邮箱每工作区只有一个写入服务，沿用已持有的工作区锁。 */
  memberDispatch(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const service=this.dispatchers.get(id);if(!service)fail('SERVICE_NOT_READY','工作区成员服务尚未就绪');return service}
  /** 每个工作区实例唯一的执行管理器；调用必须显式指定工作区。 */
  execution(id:string){this.assertServiceAvailable(id);const ws=this.workspace(id);ws.assert();const manager=this.executions.get(id);if(!manager)fail('SERVICE_NOT_READY','工作区执行服务尚未就绪');return manager}
  private stopping=false;private shutdownPromise?:Promise<void>;
  /** IPC 新增工作区前检查关停状态；只暴露读取，不允许路由修改生命周期。 */
  get isStopping(){return this.stopping}
  constructor(readonly paths:Paths,designRoot:string,secretCipher?:SecretCipher) {this.models=new LlmProfiles(path.join(paths.userRoot,'llm.json'),secretCipher);this.catalog=new Catalog(paths);this.rules=new Rules(designRoot);this.resources=new ResourceRepositories(paths)}
  async init(){await this.catalog.init();await this.rules.init();await this.resources.init();await this.restore()}
  async list(){const data=await this.catalog.read();return {...data,warning:this.catalog.warning,entries:await Promise.all(data.entries.map(async e=>this.running.get(e.id)?.view()||{...e,state:await exists(e.path)?'registered':'missing',tasks:[]}))}}
  workspace(id:string){const ws=this.running.get(id);if(!ws)fail('NOT_RUNNING','工作区未运行，请由用户在桌面打开');return ws}
  /** 合并同工作区的并发打开并装配内部执行服务；restart 只更换此工作区实例，不修改外部工具配置。 */
  async open(id:string,restart=false){if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');if(this.opening.has(id))return this.opening.get(id)!;this.assertServiceAvailable(id);
    const pending=(async()=>{const entry=(await this.catalog.read()).entries.find(x=>x.id===id);if(!entry)fail('NOT_REGISTERED','工作区未登记');let ws=this.running.get(id);
      if(restart||ws?.state!=='running'){const release=this.retire(id);try{
        await this.executions.get(id)?.close();this.executions.delete(id);
        await this.dispatchers.get(id)?.close();this.dispatchers.delete(id);
        this.monitors.get(id)?.close();await ws?.close();
        const monitor=new WorkspaceRuntimeMonitor(this.runtime,id,entry.name);this.monitors.set(id,monitor);
        ws=new Workspace(entry,this.paths,this.rules);this.running.set(id,ws);
        try{
          await ws.open();
          const service=createMemberDispatch(ws,monitor.dispatchObserver),execution=createExecutionManager(ws,this.models);
          this.dispatchers.set(id,service);this.executions.set(id,execution);
          await monitor.initialize(ws,service,execution);
        }catch(error){monitor.unavailable(error);throw error}
      }finally{release()}}
      await this.catalog.update(d=>{const item=d.entries.find(e=>e.id===id);if(item)item.lastOpened=new Date().toISOString();d.recent=[id,...d.recent.filter(x=>x!==id)].slice(0,30)});return ws})();this.opening.set(id,pending);try{return await pending}finally{this.opening.delete(id)}
  }
  // Internal maintenance only. Closing a page never stops a registered service.
  async stop(id:string){const release=this.retire(id);try{await this.opening.get(id)?.catch(()=>{});await this.executions.get(id)?.close();this.executions.delete(id);await this.dispatchers.get(id)?.close();this.dispatchers.delete(id);this.monitors.get(id)?.close();this.monitors.delete(id);const ws=this.running.get(id);await ws?.close();this.running.delete(id)}finally{release()}}
  async remove(id:string){await this.stop(id);await this.catalog.remove(id);this.runtime.forget(id)}
  async restore(){const d=await this.catalog.read();for(const entry of d.entries){try{await this.open(entry.id)}catch{/* failed workspace remains visible; continue the other services */}}}
  /** 幂等关闭应用，等待正在打开的工作区及提交完成，再释放服务和共享仓库。 */
  async shutdown(){if(this.shutdownPromise)return this.shutdownPromise;this.stopping=true;this.shutdownPromise=(async()=>{await Promise.allSettled([...this.opening.values()]);await Promise.all([...this.executions.values(),...this.dispatchers.values()].map(x=>x.close()));this.executions.clear();this.dispatchers.clear();for(const monitor of this.monitors.values())monitor.close();this.monitors.clear();const results=await Promise.allSettled([...this.running.values()].map(w=>w.close()));await this.resources.close();this.running.clear();const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason})();return this.shutdownPromise}
  /** 未显式指定引擎模型时使用保存的默认配置；只传公开标识给调度层。 */
  /** 默认选择转为明确模型身份，工作区工厂随后取得运行快照；兼容 CLI 显式模型。 */
  async modelOptions(input:any={}){
    if(input?.provider&&input?.model&&!input.profileId)return input;
    const {profile}=await this.models.resolve(input?.profileId,input?.model);
    return {...input,provider:'cbim-'+profile.id,model:profile.model,profileId:profile.id};
  }
  /** 发送前验证图片能力；队列只保存工作区快照 ID，启动时再检查当前模型。 */
  async chatOptions(id:string,input:any,attachments:unknown){
    const options=await this.modelOptions(input);
    const images=await new ChatInputs(this.workspace(id)).images(attachments);
    if(images.length&&options.profileId&&!(await this.models.resolve(options.profileId,options.model)).profile.vision)throw Error('当前模型未启用图片输入，请在设置中确认视觉能力，或切换支持图片的模型');
    return {...options,attachmentIds:attachments??[]};
  }
  /** 所有 IPC 操作通过独立路由，调用方仍需显式传入工作区身份。 */
  dispatch(action:string,args:any={}){return dispatchApplication(this,action,args)}

}
