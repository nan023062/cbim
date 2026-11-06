/**
 * 作用定位：把静态 Agent 的 Session 归档索引保存到应用用户目录，并为只读详情定位原运行日志。
 * 设计原因：每个角色/会话/轮次独立原子写入摘要，执行实例释放与知识定义删除不影响履历；不移动正文，不把聊天记录写入可共享的 .cbim 知识。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../../core/foundation/serialization';
import {atomic} from '../../../core/foundation/files';
import {safeId} from '../../../core/foundation/identity';
import {checkedAgentHistoryRecord,type AgentHistoryRecord,type AgentHistoryStore} from '../../../core/team/session-history-storage';
import {AgentHistoryService} from '../../../scheduler-engine/runtime/agent-history';
import type {Workspace} from '../../workspace/workspace';
import {FileRunStorage} from './run-storage';

/** 文件只包含派生摘要；canonical 日志才是执行事实来源，损坏条目单独报告并等待回补。 */
export class FileAgentHistoryStore implements AgentHistoryStore {
  constructor(readonly directory:string,private readonly workspaceId:string,private readonly root:string){}
  private location(record:AgentHistoryRecord){
    return {role:hash(record.view.agentId),session:hash(record.view.sessionId),file:hash(JSON.stringify([record.view.taskId,record.view.runId]))+'.json'};
  }
  /** 拒绝应用归档目录中的符号链接；外部字符串只参与 hash，不成为可注入路径片段。 */
  private async safeDirectory(directory:string){await fs.mkdir(directory,{recursive:true});if((await fs.lstat(directory)).isSymbolicLink())throw Error('Agent 历史目录不能是符号链接')}
  async put(raw:AgentHistoryRecord){
    const record=checkedAgentHistoryRecord(raw,this.workspaceId,this.root),location=this.location(record);
    const role=path.join(this.directory,location.role),sessions=path.join(role,'sessions'),session=path.join(sessions,location.session);
    for(const directory of [this.directory,role,sessions,session])await this.safeDirectory(directory);
    await atomic(path.join(session,location.file),JSON.stringify(record));
  }
  /** 启动读取轻量索引，不扫描正文；每个损坏/未知条目可见，其他可核验记录继续显示。 */
  async load(){
    const records:AgentHistoryRecord[]=[],diagnostics:string[]=[];
    const invalid=()=>{const message='部分 Agent 历史索引损坏或目录不受支持，已跳过并等待运行日志回补';if(!diagnostics.includes(message))diagnostics.push(message)};
    let roles;
    try{if((await fs.lstat(this.directory)).isSymbolicLink())throw Error('invalid root');roles=await fs.readdir(this.directory,{withFileTypes:true})}catch(error:any){if(error.code==='ENOENT')return {records,diagnostics};throw error}
    for(const role of roles){
      if(!role.isDirectory()||!/^[a-f0-9]{64}$/.test(role.name)){invalid();continue}
      try{
        const folder=path.join(this.directory,role.name,'sessions');if(!(await fs.lstat(folder)).isDirectory()||(await fs.lstat(folder)).isSymbolicLink())throw Error('invalid sessions');
        for(const session of await fs.readdir(folder,{withFileTypes:true})){
          if(!session.isDirectory()||!/^[a-f0-9]{64}$/.test(session.name)){invalid();continue}
          for(const file of await fs.readdir(path.join(folder,session.name),{withFileTypes:true})){
            if(file.name.endsWith('.tmp'))continue;
            if(!file.isFile()||!/^[a-f0-9]{64}\.json$/.test(file.name)){invalid();continue}
            try{
              const record=checkedAgentHistoryRecord(JSON.parse(await fs.readFile(path.join(folder,session.name,file.name),'utf8')),this.workspaceId,this.root),expected=this.location(record);
              if(expected.role!==role.name||expected.session!==session.name||expected.file!==file.name)throw Error('index location mismatch');
              records.push(record);
            }catch{invalid()}
          }
        }
      }catch{invalid()}
    }
    return {records,diagnostics};
  }
}

/** 工作区已打开后装配，服务关闭前不释放工作区；详情定位只能由历史索引中的固定 source/task/run 决定。 */
export function createAgentHistory(workspace:Workspace,diagnostic?:(message:string)=>void){
  const project=workspace.paths.project(workspace.entry.id),storage=new FileRunStorage();
  return new AgentHistoryService(workspace.entry.id,workspace.entry.path,{
    store:new FileAgentHistoryStore(path.join(project,'agent-history'),workspace.entry.id,workspace.entry.path),diagnostic,
    read:async record=>{
      workspace.assert();
      const root=record.journal==='member'?path.join(project,'dispatch','runs','tasks'):path.join(project,'loop-engine','tasks');
      const task=path.join(root,safeId(record.view.taskId)),directory=path.join(task,safeId(record.view.runId));
      for(const target of [root,task,directory,path.join(directory,'events.jsonl')])if((await fs.lstat(target)).isSymbolicLink())throw Error('运行日志不能经符号链接定位');
      const relative=path.relative(await fs.realpath(project),await fs.realpath(directory));
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('运行日志不在本工作区应用目录');
      const summary=await storage.read(directory);
      if(summary.task.workspaceId!==workspace.entry.id||summary.task.root!==workspace.entry.path||summary.task.taskId!==record.view.taskId||summary.runId!==record.view.runId)throw Error('运行日志身份不一致');
      return summary;
    },
  });
}
