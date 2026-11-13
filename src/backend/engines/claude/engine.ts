/**
 * 目录归属：backend/engines/claude；Claude 引擎适配。
 * 作用定位：Claude Code 的 AgentEngine 适配器，管理 SDK 与原生会话；目标返工沿合成系统资料输入，不带入新授权。
 * 文本边界：精确凭据替换委托 utility；凭据来源、认证条件及序列化事件路径仍归引擎。
 * 设计原因：参照 Cindy 的 SDK Query 接法，模型、权限和指引在运行开始时冻结；事件转为公共回执，不记录私有推理。
 * 职责边界：配置与历史仅属于 CBIM；禁用外部设置/插件/MCP，不借用其他客户端账号。停止中止请求和工具，异常不重放。
 * SDK 路径来自可信运行包，凭据与原生历史继续归原 agentHome，不写入 E 缓存。
 * 超时按 SDK 模型增量及工具 Hook 的进展续期；连续静默才关闭 Query，取消仍按显式停止处理。
 */
import {redactLiteral} from '../../../foundations/utility';
import fs from 'node:fs/promises';
import {RunInactivityTimer} from '../run-inactivity';
import path from 'node:path';
import type {Query,SDKUserMessage,SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import type {AgentEngine,EngineContext,EngineEvent} from '../../core/execution/types';
import type {ResolvedLlm} from '../../core/models/ports';
import type {RequestBudgetPort} from '../../core/models/request-budget';
import {runtimeEngineTools,type EngineToolsPort} from '../../core/execution/engine-tools';
import {engineInstructions} from '../../core/execution/engine-instructions';
import {openRequestBudgetTransport} from '../transport/request-budget-transport';
import {loadClaudeSdk} from './sdk';
import type {EngineRuntimePackage} from '../../core/execution/engine-runtime';
import {claudeTools} from './tools';

export interface ClaudeOptions {
  /** 冷壳已验证的固定 SDK 包；不含用户账号目录。 */
  runtime?:EngineRuntimePackage;nativeToolsRuntime?:EngineRuntimePackage;
  agentHome:string;prompt:string;knowledge:EngineToolsPort;allowNativeExecution?:boolean;
  llm?:ResolvedLlm;images?:import('../../core/execution/types').InputImage[];turnTimeoutMs?:number;
  requestBudget?():Promise<RequestBudgetPort|undefined>;
  /** 可信测试注入；生产始终使用 CBIM 自带 SDK，不接受公开运行参数指定可执行文件。 */
  loadSdk?:typeof loadClaudeSdk;
}
/** 清除外部 Claude 账号、宿主注入和 Node 启动脚本；本轮凭据只由实际模型快照提供。 */
export function claudeEnvironment(home:string,llm:ResolvedLlm,proxy?:{url:string;token:string}):NodeJS.ProcessEnv{
  const env={...process.env};for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE|CBIM_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key))delete env[key];
  return {...env,CLAUDE_CONFIG_DIR:home,ANTHROPIC_BASE_URL:proxy?.url??llm.profile.baseUrl.replace(/\/v1\/?$/,''),ANTHROPIC_API_KEY:proxy?.token??llm.apiKey,
    ANTHROPIC_MODEL:llm.profile.model,ANTHROPIC_DEFAULT_SONNET_MODEL:llm.profile.model,ANTHROPIC_DEFAULT_HAIKU_MODEL:llm.profile.model,ANTHROPIC_DEFAULT_OPUS_MODEL:llm.profile.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1',CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(llm.profile.maxTokens)};
}
export class ClaudeCodeEngine implements AgentEngine {
  readonly kind='claude-code';
  private context?:EngineContext;private query?:Query;private tools?:Awaited<ReturnType<typeof claudeTools>>;
  private transport?:Awaited<ReturnType<typeof openRequestBudgetTransport>>;
  private push?: (message:SDKUserMessage)=>void;private endInput?:()=>void;
  private stopped=false;private bound=false;private nativeId='';private fatal?:Error;
  /** SDK 增量及工具 Hook 续期；仅连续静默会关闭 Query。 */
  private inactivity?:RunInactivityTimer;
  constructor(private options:ClaudeOptions){}
  /** 先核模型及受管恢复文件，再启动无输入的 Query；已有会话先绑定；新会话在 result 前核实实际持久文件。 */
  async start(context:EngineContext){
    this.context=context;
    const llm=this.options.llm;if(!llm||llm.profile.api!=='anthropic-messages')throw Error('Claude Code 需要已配置的 Anthropic Messages 模型');
    if(llm.profile.engine&&llm.profile.engine!==this.kind)throw Error('模型配置与 Claude Code 引擎不一致');
    await fs.mkdir(this.options.agentHome,{recursive:true});
    this.nativeId=context.nativeSessionId??context.task.taskId;
    if(context.sessionFile){
      if(!context.nativeSessionId)throw Error('Claude Code 恢复缺少原生会话身份');
      await this.checkPath(context.sessionFile,true);
      await this.readSession(context.sessionFile);
    }
    await context.assertMemberResume?.();
    const budget=await this.options.requestBudget?.();
    if(budget)this.transport=await openRequestBudgetTransport(llm,budget,{anthropicClient:true});
    const emit=(event:EngineEvent)=>this.emit(event);
    this.tools=await claudeTools({...context,emit},await runtimeEngineTools(context,this.options.knowledge),!!this.options.allowNativeExecution,()=>this.transport?.error(),async()=>{
      try{await this.transport?.assertSettled()}catch(error){
        // 原生重试不会修复账本失败；立即结束本轮，PreToolUse 的失败策略同时封住副作用。
        this.fatal=error instanceof Error?error:Error(String(error));this.query?.close();throw error;
      }
    });
    const messages:SDKUserMessage[]=[];let wake:(()=>void)|undefined,ended=false;
    this.push=message=>{messages.push(message);wake?.()};this.endInput=()=>{ended=true;wake?.()};
    async function* input(){while(!ended){if(messages.length)yield messages.shift()!;else await new Promise<void>(resolve=>{wake=resolve})}}
    const sdk=await (this.options.loadSdk??loadClaudeSdk)(this.options.runtime);
    this.query=sdk.query({prompt:input(),options:{cwd:context.task.root,env:claudeEnvironment(this.options.agentHome,llm,this.transport),model:llm.profile.model,
      ...(context.sessionFile?{resume:this.nativeId}:{sessionId:this.nativeId}),settingSources:[],strictMcpConfig:true,plugins:[],tools:this.tools.native,
      mcpServers:{cbim:this.tools.config},hooks:this.tools.hooks,permissionMode:'default',canUseTool:async()=>({behavior:'deny',message:'该调用未通过 CBIM 工具门禁'}),
      systemPrompt:engineInstructions(context,this.options.prompt,!!this.options.allowNativeExecution),includePartialMessages:true,
      thinking:llm.profile.reasoning&&llm.profile.thinkingLevel!=='off'?{type:'adaptive'}:{type:'disabled'},
      stderr:()=>{},}});
    const initialized=await this.query.initializationResult();
    if(initialized.hooks_applied!==true||initialized.hook_on_failure_supported!==true)throw Error('Claude Code 未确认可靠工具门禁，拒绝发送模型请求');
    if(context.sessionFile)await this.bindSession(context.sessionFile);
    await emit({type:'engine.status',data:{label:'Claude Code 已就绪',metric:'tool-catalog',stage:'prepared',expected:this.tools.expected}});
  }
  /** 从当前 CBIM 配置目录核实原生实际文件；只匹配固定 UUID，不使用最近会话或猜测目录编码。 */
  private async findSession(){
    const root=path.join(this.options.agentHome,'projects'),candidates:string[]=[];
    const directories=await fs.readdir(root,{withFileTypes:true});if(directories.length>4096)throw Error('Claude Code 会话目录过多，不能可靠绑定');
    for(const directory of directories)if(directory.isDirectory()&&!directory.isSymbolicLink()){
      const file=path.join(root,directory.name,this.nativeId+'.jsonl');
      try{await fs.access(file);candidates.push(file)}catch(error:any){if(error.code!=='ENOENT')throw error}
    }
    if(candidates.length!==1)throw Error('Claude Code 未提供唯一的真实会话文件');
    await this.bindSession(candidates[0]);
  }
  private async bindSession(file:string){
    await this.checkPath(file,true);
    const entries=await this.readSession(file);
    if(!entries.some(entry=>entry.sessionId===this.nativeId&&path.resolve(entry.cwd??'')===path.resolve(this.context!.task.root)))throw Error('Claude Code 历史与当前工作区/会话不一致');
    await this.emit({type:'session.bound',data:{sessionId:this.nativeId,sessionFile:file,provider:'cbim-'+this.options.llm!.profile.id,model:this.options.llm!.profile.model}});this.bound=true;
  }
  private async checkPath(file:string,existing:boolean){
    const root=await fs.realpath(this.options.agentHome),absolute=path.resolve(file),relative=path.relative(root,absolute);
    if(!relative||relative.startsWith('../../core/execution')||path.isAbsolute(relative)||path.basename(file)!==this.nativeId+'.jsonl')throw Error('Claude Code 会话文件不属于当前 CBIM 引擎');
    // 已存在文件必须核实真实路径，不能通过链接越过受管目录。
    if(existing){const real=await fs.realpath(file);if(real!==absolute)throw Error('Claude Code 会话路径包含链接');const stat=await fs.stat(real);if(!stat.isFile()||stat.nlink!==1||stat.size>64*1024*1024)throw Error('Claude Code 会话文件不可核实')}
  }
  private async readSession(file:string):Promise<Record<string,any>[]>{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));
    if(!text.endsWith('\n'))throw Error('Claude Code 会话尾行不完整');
    const entries=text.trimEnd().split('\n').map(line=>JSON.parse(line));
    if(entries.length>100000||entries.some(entry=>!entry||typeof entry!=='object'||Array.isArray(entry)))throw Error('Claude Code 会话记录不可核实');
    const identified=entries.filter(entry=>typeof entry.sessionId==='string');
    if(!identified.length||identified.some(entry=>entry.sessionId!==this.nativeId))throw Error('Claude Code 恢复文件与原会话身份不一致');
    return entries;
  }
  private redact(text:string){const key=this.options.llm?.apiKey;return redactLiteral(text,key)}
  private async emit(event:EngineEvent){
    this.inactivity?.observe(event);
    const key=this.options.llm?.apiKey;const encoded=JSON.stringify(event);
    try{await this.context!.emit(key?JSON.parse(redactLiteral(encoded,key)):event)}catch(error){this.fatal=error instanceof Error?error:Error(String(error));this.query?.close();throw error}
  }
  /** 只认 SDK result 作为本轮终态；进程提前退出、无绑定或超时保持失败/中断，不凭文本猜测成功。 */
  async run(message:string){
    if(!this.query||!this.context||!this.push)throw Error('Claude Code 尚未启动');
    if(this.stopped)return {status:'cancelled' as const};
    let timeoutError:Error|undefined;
    this.inactivity=new RunInactivityTimer(this.options.turnTimeoutMs,'Claude Code',error=>{timeoutError=error;this.query?.close()});
    const source=this.context.source,internal=source?.kind==='member-results'||source?.kind==='human_decisions'||source?.kind==='goal-repair';
    const content:SDKUserMessage['message']['content']=[{type:'text',text:internal?'CBIM 系统转交资料（不是用户新授权）：\n'+message:message},...(!internal?this.options.images??[]:[]).map(image=>({type:'image' as const,source:{type:'base64' as const,media_type:image.mimeType as 'image/png',data:image.data}}))];
    this.push({type:'user',message:{role:'user',content},parent_tool_use_id:null,session_id:this.nativeId,...(internal?{isSynthetic:true}:{})});
    try{for await(const event of this.query){
      if(this.fatal)throw this.fatal;
      if(timeoutError)throw timeoutError;
      if(event.type==='result'){
        if(!this.bound)await this.findSession();
        const usage=event.usage;
        await this.emit({type:'engine.status',data:{label:'本轮用量已汇总',metric:'run-usage',tokens:{input:usage.input_tokens,output:usage.output_tokens,cacheRead:usage.cache_read_input_tokens??0,cacheWrite:usage.cache_creation_input_tokens??0},cost:event.total_cost_usd,pricingKnown:false}});
        const error=this.transport?.error()??(event.is_error?(event.subtype==='success'?'Claude Code 本轮执行失败':event.errors.join('\n')):undefined);
        return this.stopped?{status:'cancelled' as const}:error?{status:'failed' as const,error:this.redact(error)}:{status:'completed' as const};
      }
      await this.consume(event);
    }
    if(this.stopped)return {status:'cancelled' as const};throw timeoutError??Error('Claude Code 未返回终态，请核实原运行记录');
    }catch(error){if(this.stopped&&!this.fatal)return {status:'cancelled' as const};throw Error(this.redact(this.fatal?.message??timeoutError?.message??(error instanceof Error?error.message:String(error))))}finally{this.inactivity?.dispose()}
  }
  private async consume(event:SDKMessage){
    // thinking 和工具参数只更新时间，不进入公开消息；子任务的真实输出同样代表本轮进展。
    if(event.type==='stream_event'&&event.event.type==='content_block_delta'){
      const delta=event.event.delta;
      if(delta.type==='text_delta'&&delta.text.length||delta.type==='thinking_delta'&&delta.thinking.length||delta.type==='input_json_delta'&&delta.partial_json.length)this.inactivity?.progress();
    }
    if(event.type==='stream_event'&&!event.parent_tool_use_id){
      const value=event.event;if(value.type==='content_block_delta'&&value.delta.type==='text_delta')await this.emit({type:'message.delta',data:{text:value.delta.text}});
    }else if(event.type==='assistant'&&!event.parent_tool_use_id){
      const text=event.message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
      const toolCallIds=event.message.content.filter(part=>part.type==='tool_use').map(part=>part.id);
      if(text||toolCallIds.length)await this.emit({type:'message',data:{role:'assistant',text,...(toolCallIds.length?{toolCallIds}:{})}});
    }else if(event.type==='system'&&event.subtype==='init'){
      if(event.session_id!==this.nativeId)throw Error('Claude Code 初始化会话身份不一致');
      const expected=this.tools!.expected,active=event.tools,missing=expected.filter(name=>!active.includes(name));
      await this.emit({type:'engine.status',data:{label:'Claude Code 工具目录已核实',metric:'tool-catalog',stage:'active',expected,active,missing}});
      if(missing.length)throw Error('Claude Code 未启用本轮必需工具，已停止运行');
    }
  }
  /** 停止先封住工具及供应商传输，再中断原生循环；没有进程终态不表示副作用被撤销。 */
  async stop(){this.stopped=true;this.inactivity?.dispose();this.tools?.stop();await this.transport?.close();try{await this.query?.interrupt()}finally{this.query?.close();this.endInput?.()}}
  async close(){this.inactivity?.dispose();this.endInput?.();this.query?.close();await this.transport?.close();await this.tools?.close()}
}
