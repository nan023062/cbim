/**
 * 作用定位：调度引擎：将工作区内部知识服务、内核锁与前置策略注入独立 LoopRuntime。
 * 设计原因：原生与知识工具共用运行授权；任务记录工具在 gate 前校验参数，仅维护本运行记录、不授予业务写权限。领域事务与平台边界不可豁免。
 */
import {questionTool} from '../conversation/questions';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import type {StoragePaths as Paths} from '../../core/foundation/paths';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {knowledgeTools} from '../tools/knowledge-tools';
import {loopInstructions} from '../context/team-workflow';
import {mainAgentInstructions} from '../conversation/main-agent';
import type {ChatPermission} from '../../core/brain/types';
import {LoopRuntime,PiEngine,type TaskSpec,type StoredEvent,type ToolCall,type ToolDecision} from '../../core/brain';
import type {PiCommand} from '../../core/brain/pi/rpc';
import type {ResolvedLlm} from '../../core/brain/llm/ports';
import {authorizeRunTool} from '../../core/policy/tool-policy';
import {questionInput} from '../../core/tools/questions';
import {progressTool} from '../../core/tasks/progress-tools';

/** 工作区执行装配参数；未指定权限时默认只读，知识与业务写入由同一运行策略控制。 */
export interface WorkspaceLoopOptions {
  /** 由持久化任务身份确定指引，不接收界面任意提示词。 */
  mode?:'chat';
  /** 工作区附件身份可持久化到队列；图片字节仅由主进程装配提供。 */
  attachmentIds?:string[];
  images?:{type:'image';data:string;mimeType:string}[];
  provider:string;model:string;profileId?:string;
  allowNativeExecution?:boolean;
  permission?:ChatPermission;
  /** 逐次询问模式由工作区管理器挂起，界面明确允许或拒绝后才继续。 */
  requestQuestion?(args:unknown,signal:AbortSignal):Promise<unknown>;
  requestApproval?(call:ToolCall):Promise<ToolDecision>;
  process?:PiCommand;
  turnTimeoutMs?:number;
  onEvent?(event:StoredEvent):void;
  /** 由主进程解析的 LLM 运行配置，不接受模型工具参数直接提供密钥。 */
  llm?:ResolvedLlm;
}
/** 装配方注入的运行保障；无默认放行策略，缺少实现不能启动执行。 */
export interface ExecutionServices {
  /** 与执行管理器共用同一工作区存储适配。 */
  storage:import('../../core/brain/storage').RunStorage;
  /** 跨进程任务互斥；返回释放函数，由运行时在结束后调用。 */
  acquireLease(task:TaskSpec):Promise<()=>void>;
  /** 原生工具仍须通过平台边界；两类写入共用运行授权，知识另核验 Schema、实例与版本。 */
  authorizeNative(call:ToolCall):Promise<ToolDecision>;
}
async function bundledPiEntry(){
  const requireRuntime=createRequire(typeof __filename==='string'?__filename:import.meta.url);
  // Electron 的外部资源包含完整 Pi 生产依赖，不依赖开发机 node_modules。
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const roots=[...(resources?[path.join(resources,'pi-runtime','node_modules')]:[]),...(requireRuntime.resolve.paths('@earendil-works/pi-coding-agent')??[])];
  for(const root of roots){
    const directory=path.join(root,'@earendil-works/pi-coding-agent');
    let source:string;try{source=await fs.readFile(path.join(directory,'package.json'),'utf8')}catch(error:any){if(error.code==='ENOENT')continue;throw error}
    const pkg=JSON.parse(source);if(pkg.version!=='1.5.0')throw Error('当前 Loop Engine 仅验证过 Pi 1.5.0');
    const file=path.join(directory,'dist/bundle/rpc-entry.js');await fs.access(file);return file;
  }
  throw Error('缺少 Pi 运行时，请先安装项目依赖');
}
/** 必须由工作区所有者装配；直接接入内部知识服务，保留权限与版本检查。 */
export async function createWorkspaceLoop(paths:Paths,owner:KnowledgeWorkspace,options:WorkspaceLoopOptions,services:ExecutionServices){
  owner.assert();
  const workspace=await paths.identity(owner.entry.path);
  if(workspace.id!==owner.entry.id)throw Error('工作区身份不匹配');
  const service=knowledgeTools(owner);
  const directory=path.join(paths.project(workspace.id),'loop-engine');await fs.mkdir(directory,{recursive:true});
  const agentHome=path.join(directory,'pi');
  const command=options.process??{command:process.execPath,args:[await bundledPiEntry()],env:{ELECTRON_RUN_AS_NODE:'1'}};
  const permission=options.permission??(options.allowNativeExecution?'execute':'read');
  const policyContext={workspaceId:workspace.id,permission,guard:services.authorizeNative,approve:options.requestApproval};
  const runtime=new LoopRuntime({
    storage:services.storage,
    directory:path.join(directory,'tasks'),
    acquireLease:async task=>{
      if(task.workspaceId!==workspace.id||task.root!==workspace.path)throw Error('任务与工作区身份不匹配');
      return services.acquireLease(task);
    },
    createEngine:()=>new PiEngine({process:command,provider:options.provider,model:options.model,llm:options.llm,images:options.images,agentHome,prompt:(options.mode==='chat'?mainAgentInstructions:loopInstructions)+(options.requestQuestion?'\n需要用户在多个方向、方案或偏好间选择时，调用 cbim_ask_user_question 展示选项卡，等待答复后继续，不要仅在正文列编号让用户回复。界面自动提供其它补充输入，不要把其它添加到 options。常规实现细节自行判断，不为不必要的选择打断任务。问题回答不等于工具授权。':''),allowNativeExecution:permission!=='read',turnTimeoutMs:options.turnTimeoutMs,
      knowledge:{
        list:async()=>[...service.list(),...(options.requestQuestion?[questionTool]:[])],
        call:async(name,args,signal)=>name===questionTool.name&&options.requestQuestion?{content:[{type:'text',text:JSON.stringify(await options.requestQuestion(args,signal))}]}:service.callFromRun(name,args,permission!=='read',signal),
      },
    }),
    toolPolicy:async call=>{
      owner.assert();
      try{
        const progress=progressTool(call.name,call.input);if(progress)return await authorizeRunTool(call,progress,policyContext);
        if(call.name===questionTool.name&&options.requestQuestion){questionInput.parse(call.input);return await authorizeRunTool(call,{effects:['read'],native:false},policyContext)}
        if(call.name.startsWith('cbim_'))return await authorizeRunTool(call,service.describe(call.name,call.input),policyContext);
        if(!['read','grep','find','ls','bash','write','edit'].includes(call.name))return {allow:false,reason:'当前运行未授权此工具'};
        return await authorizeRunTool(call,{effects:[call.name==='bash'?'command':['write','edit'].includes(call.name)?'business-write':'read'],native:true},policyContext);
      }catch(error){return {allow:false,reason:error instanceof Error?error.message:String(error)}}
    },onEvent:options.onEvent,
  });
  return {runtime,workspace,agentHome,newTask:(goal:string,acceptance:string[]=[]):TaskSpec=>({taskId:randomUUID(),workspaceId:workspace.id,root:workspace.path,goal,moduleIds:[],acceptance})};
}
