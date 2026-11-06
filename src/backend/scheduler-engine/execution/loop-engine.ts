/**
 * 作用定位：调度引擎：将工作区内部知识服务、内核锁与前置策略注入独立 LoopRuntime。
 * 设计原因：传递主进程解析的图片字节给 Pi；仅依赖 Core 与注入的运行保障接口，平台锁和模型由应用装配，依据持久化身份选主 Agent 或团队任务指引，并在原生写入前执行权限审批；结构化问题经注入通道等待用户答复。
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

/** 工作区执行装配参数；默认只开放本地只读工具和受工作区写入开关保护的知识工具。 */
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
  /** 原生工具白名单检查后仍须通过此策略；知识写入另由 Core 校验授权。 */
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
/** 必须由工作区所有者装配；不发现或连接外部 MCP，权限与版本检查保留。 */
export async function createWorkspaceLoop(paths:Paths,owner:KnowledgeWorkspace,options:WorkspaceLoopOptions,services:ExecutionServices){
  owner.assert();
  const workspace=await paths.identity(owner.entry.path);
  if(workspace.id!==owner.entry.id)throw Error('工作区身份不匹配');
  const service=knowledgeTools(owner);
  const directory=path.join(paths.project(workspace.id),'loop-engine');await fs.mkdir(directory,{recursive:true});
  const agentHome=path.join(directory,'pi');
  const command=options.process??{command:process.execPath,args:[await bundledPiEntry()],env:{ELECTRON_RUN_AS_NODE:'1'}};
  let allowedKnowledge=new Set<string>();
  const runtime=new LoopRuntime({
    storage:services.storage,
    directory:path.join(directory,'tasks'),
    acquireLease:async task=>{
      if(task.workspaceId!==workspace.id||task.root!==workspace.path)throw Error('任务与工作区身份不匹配');
      return services.acquireLease(task);
    },
    createEngine:()=>new PiEngine({process:command,provider:options.provider,model:options.model,llm:options.llm,images:options.images,agentHome,prompt:(options.mode==='chat'?mainAgentInstructions:loopInstructions)+(options.requestQuestion?'\n需要用户在多个方向、方案或偏好间选择时，调用 cbim_ask_user_question 展示选项卡，等待答复后继续，不要仅在正文列编号让用户回复。界面自动提供其它补充输入，不要把其它添加到 options。常规实现细节自行判断，不为不必要的选择打断任务。问题回答不等于工具授权。':''),allowNativeExecution:options.allowNativeExecution,turnTimeoutMs:options.turnTimeoutMs,
      knowledge:{
        list:async()=>{const tools=[...service.list(),...(options.requestQuestion?[questionTool]:[])];allowedKnowledge=new Set(tools.map(t=>t.name));return tools},
        call:async(name,args,signal)=>name===questionTool.name&&options.requestQuestion?{content:[{type:'text',text:JSON.stringify(await options.requestQuestion(args,signal))}]}:service.call(name,args,true,signal),
      },
    }),
    toolPolicy:async call=>{
      if(allowedKnowledge.has(call.name))return {allow:true}; // 内部工具仍受工作区写入授权控制。
      const native=options.allowNativeExecution?['read','grep','find','ls','bash','write','edit']:['read','grep','find','ls'];
      if(!native.includes(call.name))return {allow:false,reason:'当前运行未授权此工具'};
      const decision=await services.authorizeNative(call);if(!decision.allow)return decision;
      if(options.permission==='ask'&&['bash','write','edit'].includes(call.name))return options.requestApproval?options.requestApproval(call):{allow:false,reason:'审批通道不可用'};
      return decision;
    },onEvent:options.onEvent,
  });
  return {runtime,workspace,agentHome,newTask:(goal:string,acceptance:string[]=[]):TaskSpec=>({taskId:randomUUID(),workspaceId:workspace.id,root:workspace.path,goal,moduleIds:[],acceptance})};
}
