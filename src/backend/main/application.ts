/**
 * 作用定位：单次运行授权、版本化队列增量和结构化问题按工作区路由；排队时冻结附件内容与模型身份。Application：登记及重命名工作区、装配模型供应商与服务，并统一派发主 Agent 对话、附件快照、工具审批和历史操作。
 * 设计原因：路由队列编辑、拖动和插入，操作始终携带工作区与会话身份；发送图片前验证所选模型，向队列传递附件快照身份；模型目录入口同时保留 ID 兼容接口和能力元数据接口；集中服务与执行管理；停止或替换工作区前先排空 loop，页面切换不影响执行。
 */
import path from 'node:path';
import {dispatchApplication} from './ipc/dispatch';
import type {ApplicationServices} from './ipc/services';
import {LlmProfiles,type SecretCipher} from './persistence/settings/llm-profiles';
import {createExecutionManager} from './execution';
import {ChatInputs} from './persistence/tasks/chat-inputs';
import type {WorkspaceExecutionManager} from '../scheduler-engine/execution/execution-manager';
import {pathToFileURL} from 'node:url';
import {Catalog} from './workspace/catalog';
import {Paths} from './platform/paths';
import {exists} from '../core/foundation/files';
import {fail} from '../core/foundation/errors';
import {Rules} from '../core/knowledge/knowledge';
import {Workspace} from './workspace/workspace';
import {serve} from './integrations/mcp/mcp';
import {ResourceRepositories} from './resources/resource-repository';
import {installHostConfigs,type HostRuntime} from './integrations/hosts/host-config';
import {installHostInstructions} from './integrations/hosts/host-instructions';
import {installHostProtection} from './integrations/hosts/host-protection';
/** 实现路由所需的服务契约；IPC 层不反向依赖本应用类。 */
export class Application implements ApplicationServices {
  readonly catalog:Catalog;readonly rules:Rules;readonly running=new Map<string,Workspace>();private opening=new Map<string,Promise<Workspace>>();
  readonly resources:ResourceRepositories;
  /** 全应用共享供应商目录；公开 IPC 不返回凭据，运行时才解密。 */
  readonly models:LlmProfiles;
  private executions=new Map<string,WorkspaceExecutionManager>();
  /** 每个工作区实例唯一的执行管理器；调用必须显式指定工作区。 */
  execution(id:string){const ws=this.workspace(id);ws.assert();if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');let manager=this.executions.get(id);if(!manager){manager=createExecutionManager(ws,this.models);this.executions.set(id,manager)}return manager}
  private stopping=false;private shutdownPromise?:Promise<void>;
  /** IPC 新增工作区前检查关停状态；只暴露读取，不允许路由修改生命周期。 */
  get isStopping(){return this.stopping}
  constructor(readonly paths:Paths,designRoot:string,readonly hostRuntime:HostRuntime={command:process.execPath,args:['--import',pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href,path.resolve('src/backend/main/integrations/hosts/host-bridge.ts')]},/** 保留既有桌面外部接入；内部 CLI 可关闭宿主安装与 MCP 发布。 */ readonly externalHost=true,secretCipher?:SecretCipher ) {this.models=new LlmProfiles(path.join(paths.userRoot,'llm.json'),secretCipher);this.catalog=new Catalog(paths);this.rules=new Rules(designRoot);this.resources=new ResourceRepositories(paths)}
  async init(){await this.catalog.init();await this.rules.init();await this.resources.init();await this.restore()}
  async list(){const data=await this.catalog.read();return {...data,warning:this.catalog.warning,entries:await Promise.all(data.entries.map(async e=>this.running.get(e.id)?.view()||{...e,state:await exists(e.path)?'registered':'missing',tasks:[],writable:false}))}}
  workspace(id:string){const ws=this.running.get(id);if(!ws)fail('NOT_RUNNING','工作区未运行，请由用户在桌面打开');return ws}
  /** 合并同工作区的并发打开；运行服务后同步宿主配置，restart 只更换此工作区实例。 */
  async open(id:string,restart=false){if(this.stopping)fail('SHUTTING_DOWN','CBIM 正在退出');if(this.opening.has(id))return this.opening.get(id)!;
    const pending=(async()=>{const entry=(await this.catalog.read()).entries.find(x=>x.id===id);if(!entry)fail('NOT_REGISTERED','工作区未登记');let ws=this.running.get(id);
      if(restart||ws?.state!=='running'){await this.executions.get(id)?.close();this.executions.delete(id);await ws?.close();ws=new Workspace(entry,this.paths,this.rules);this.running.set(id,ws);await ws.open(this.externalHost?serve:undefined)}
      if(this.externalHost){ws.hostConfigWarnings=await installHostConfigs(this.paths,entry,this.hostRuntime);
      ws.hostConfigWarnings.push(...await installHostInstructions(this.paths,entry));
      ws.hostConfigWarnings.push(...await installHostProtection(this.paths,entry,this.hostRuntime));}
      await this.catalog.update(d=>{const item=d.entries.find(e=>e.id===id);if(item)item.lastOpened=new Date().toISOString();d.recent=[id,...d.recent.filter(x=>x!==id)].slice(0,30)});return ws})();this.opening.set(id,pending);try{return await pending}finally{this.opening.delete(id)}
  }
  // Internal maintenance only. Closing a page never stops a registered service.
  async stop(id:string){await this.opening.get(id)?.catch(()=>{});await this.executions.get(id)?.close();this.executions.delete(id);const ws=this.running.get(id);await ws?.close();this.running.delete(id)}
  async remove(id:string){await this.stop(id);await this.catalog.remove(id)}
  async restore(){const d=await this.catalog.read();for(const entry of d.entries){try{await this.open(entry.id)}catch{/* failed workspace remains visible; continue the other services */}}}
  /** 幂等关闭应用，等待正在打开的工作区及提交完成，再释放服务和共享仓库。 */
  async shutdown(){if(this.shutdownPromise)return this.shutdownPromise;this.stopping=true;this.shutdownPromise=(async()=>{await Promise.allSettled([...this.opening.values()]);await Promise.all([...this.executions.values()].map(x=>x.close()));this.executions.clear();const results=await Promise.allSettled([...this.running.values()].map(w=>w.close()));await this.resources.close();this.running.clear();const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason})();return this.shutdownPromise}
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
