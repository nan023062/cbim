/**
 * 目录归属：backend/main/models；模型配置持久化。
 * 作用定位：保存工作区主 Agent 的引擎和模型，两处界面共用这一份配置。
 * 设计原因：内置主 Agent 没有可编辑的知识定义文件，采用本机工作区设置；选型契约与自定义 Agent 相同，配置保存不启动执行、不修改任何任务快照。
 */
import fs from 'node:fs/promises';
import {SerialQueue} from '../../core/foundation/utility';
import {z} from 'zod';
import {atomic} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {agentModelSelectionSchema} from '../../core/models/engine';
import {mainAgentIdentitySchema,mainAgentSettingsSchema,type MainAgentSettingsView} from '../../core/team/agent-runtime';
import type {LlmProfiles} from './llm-profiles';

const stored=z.object({version:z.literal(1),revision:z.number().int().nonnegative().safe(),selection:agentModelSelectionSchema.nullable()}).strict();
type Identity=Pick<MainAgentSettingsView,'workspaceId'|'instanceId'>;
/** 应用唯一实例；路径及当前工作区校验由 Main 注入，IPC 不接受文件路径。 */
export class MainAgentSettings {
  /** 顺序化主 Agent 配置；工作区身份、revision 与模型锁仍由 configure 核实。 */
  private readonly queue=new SerialQueue();
  constructor(private filename:(workspaceId:string)=>string,private assertCurrent:(identity:Identity)=>void,private models:LlmProfiles){}
  private async readStored(workspaceId:string){
    try{return stored.parse(JSON.parse(await fs.readFile(this.filename(workspaceId),'utf8')))}
    catch(error){if((error as {code?:string}).code==='ENOENT')return {version:1 as const,revision:0,selection:null};fail('AGENT_SETTINGS_READ','主 Agent 配置读取失败，请检查配置文件后重试')}
  }
  /** 只读取配置，不读取密钥或创建运行；两处界面及所有主会话看到相同 revision。 */
  async read(raw:unknown):Promise<MainAgentSettingsView>{
    const identity=mainAgentIdentitySchema.parse(raw);this.assertCurrent(identity);
    const {version:_,...value}=await this.readStored(identity.workspaceId);this.assertCurrent(identity);
    return {...identity,agentId:'cbim:main',...value};
  }
  /** 保存完整选型；模型校验与写盘共享配置短锁，写盘成功才发布新 revision。 */
  configure(raw:unknown):Promise<MainAgentSettingsView>{
    const input=mainAgentSettingsSchema.parse(raw);
    return this.queue.run(async()=>{
      const {workspaceId,instanceId}=input,identity={workspaceId,instanceId};this.assertCurrent(identity);
      const current=await this.readStored(workspaceId);
      if(current.revision!==input.revision)fail('AGENT_SETTINGS_CONFLICT','主 Agent 配置已在其他入口更新，请重新读取后保存');
      if(JSON.stringify(current.selection)===JSON.stringify(input.selection))return {...identity,agentId:'cbim:main' as const,revision:current.revision,selection:current.selection};
      if(current.revision>=Number.MAX_SAFE_INTEGER)fail('AGENT_SETTINGS_LIMIT','主 Agent 配置版本已达上限');
      const next={version:1 as const,revision:current.revision+1,selection:input.selection};
      await this.models.withConfigurations(input.selection?[input.selection]:[],async()=>{
        this.assertCurrent(identity);
        try{await atomic(this.filename(workspaceId),JSON.stringify(next,null,2))}
        catch{fail('AGENT_SETTINGS_WRITE','主 Agent 配置保存失败，原配置仍然有效，请检查目录权限后重试')}
      });
      return {...identity,agentId:'cbim:main' as const,revision:next.revision,selection:next.selection};
    });
  }
}
