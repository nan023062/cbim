/**
 * 作用定位：大脑 执行层：PiEngine：启动隔离配置的 Pi 子进程、转换事件并等待 agent_settled。
 * 设计原因：原生 steer 在动作边界消费补充，核对当前运行及图片能力；模型 input 按视觉能力生成，用户图片经 RPC 独立传递并读回能力检查；适配 Pi 事件与会话；每轮隔离运行设置并核对思考、压缩及重试，记录生成耗时、价格可用性及原生上下文估计；每次运行隔离模型配置并由环境注入凭据，按模式注入主 Agent 对话身份或冻结团队上下文，记录去重的思考/生成状态，只记录公开文本增量，以 agent_settled 判定结束。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {AgentEngine,EngineContext,EngineEvent} from '../types';
import {PiRpc,type PiCommand} from './rpc';
import {openBridge,bridgeExtension,type KnowledgeBridge} from './bridge';
import type {ResolvedLlm} from '../llm/ports';
import {modelStopError} from '../model-errors';
import {buildPiRuntimeSettings,requestedThinkingLevel} from './runtime-config';

/** 单次 Pi 适配器配置；agentHome 只属于 CBIM 工作区，turnTimeoutMs 为回合等待上限毫秒。 */
export interface PiOptions {
  process:PiCommand;
  provider:string;
  model:string;
  /** Dedicated CBIM engine settings; never reuse a user's external Pi home. */
  agentHome:string;
  prompt:string;
  knowledge:KnowledgeBridge;
  allowNativeExecution?:boolean;
  turnTimeoutMs?:number;
  /** 仅本次进程装配使用；凭据通过环境注入，不写入指引、模型文件或事件。 */
  llm?:ResolvedLlm;
  /** 本轮用户明确附加的图片快照；经主进程读取，不作为系统指令。 */
  images?:{type:'image';data:string;mimeType:string}[];
}
export class PiEngine implements AgentEngine {
  readonly kind='pi';
  private context?:EngineContext;
  private rpc?:PiRpc;
  private bridge?:Awaited<ReturnType<typeof openBridge>>;
  private events:Promise<void>=Promise.resolve();
  private settlement?:{resolve:(value:{status:'completed'|'cancelled'|'failed';error?:string})=>void;reject:(error:Error)=>void};
  private assistantError?:string;
  /** 只测模型消息生成区间，排除工具和人工审批；旧记录不补造速度。 */
  private generationStarted?:number;
  /** 仅状态类别去重；绝不持久化推理增量正文。 */
  private activity?:string;
  /** 原生发送前已裁剪的请求额度，与界面配置上限分开。 */
  private requestLimit?:number;
  /** 原生会话累计值的本轮起点；结束取差额，包含摘要成本且恢复不重复累计。 */
  private usageBaseline?:{tokens:Record<string,number>;cost:number};
  private closing=false;private stopped=false;private fatal?:Error;
  constructor(private options:PiOptions){}
  async start(context:EngineContext){
    this.context=context;
    await fs.mkdir(this.options.agentHome,{recursive:true});
    const sessionDir=path.join(this.options.agentHome,'sessions');await fs.mkdir(sessionDir,{recursive:true});
    if(context.sessionFile){
      const file=await fs.realpath(context.sessionFile),root=await fs.realpath(sessionDir),rel=path.relative(root,file);
      if(rel.startsWith('..')||path.isAbsolute(rel)||!rel)throw Error('Pi 恢复文件不属于此 CBIM 工作区');
    }
    this.bridge=await openBridge(this.options.knowledge,context.beforeTool,async usage=>{
      this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'上下文用量已更新',metric:'context',...usage}}));await this.events;
    },async limit=>{this.requestLimit=limit;this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'模型请求额度',metric:'request-limit',maxTokens:limit}}));await this.events});
    const extension=path.join(context.directory,'cbim-extension.mjs'),prompt=path.join(context.directory,'instructions.md');
    // 业务上下文随任务持久化；执行恢复使用原快照，当前知识修改仍由服务校验版本。
    // 普通对话的用户文字与附件只经用户消息发送，不抬升为系统指引。
    const systemContext=context.task.mode==='chat'?{taskId:context.task.taskId,workspaceId:context.task.workspaceId,root:context.task.root,agentId:context.task.agentId}:context.task;
    const executionHint=this.options.allowNativeExecution?'\n本轮已提供 write/edit/bash 执行工具，可创建业务文件和运行验证。工具调用受 CBIM 策略及用户批准控制；业务写入与知识提交共用本轮权限，知识变更仍须通过 cbim_ 工具、版本检查和事务校验。':'\n本轮为只读模式，未提供 write/edit/bash。如需实现文件，请提示用户将输入框权限改为逐次询问或允许执行，再发送消息继续；不需要配置 MCP 或开启知识库写入。';
    const instructions=this.options.prompt+executionHint+(context.task.mode==='chat'?'\n\n当前工作区对话身份：\n':'\n\n任务定义与冻结的团队工作流上下文：\n')+JSON.stringify(systemContext,null,2);
    await fs.writeFile(extension,bridgeExtension,{mode:0o600});await fs.writeFile(prompt,instructions,{mode:0o600});
    // 所有运行拥有独立设置，CLI 的模型目录也只复制快照，避免并发互相覆盖。
    const configHome=path.join(context.directory,'provider');await fs.mkdir(configHome,{recursive:true});
    if(!this.options.llm){try{await fs.copyFile(path.join(this.options.agentHome,'models.json'),path.join(configHome,'models.json'))}catch(e:any){if(e.code!=='ENOENT')throw e}}
    await fs.writeFile(path.join(configHome,'settings.json'),JSON.stringify(buildPiRuntimeSettings(this.options.llm?.profile)),{mode:0o600});
    const modelEnv:NodeJS.ProcessEnv={};
    if(this.options.llm){
      const {profile,apiKey}=this.options.llm;
      // 每次运行独立配置，切换设置不会覆盖其他正在执行的模型；会话仍在工作区目录。
      await fs.writeFile(path.join(configHome,'models.json'),JSON.stringify({providers:{[this.options.provider]:{baseUrl:profile.baseUrl,api:profile.api,apiKey:'$CBIM_LLM_API_KEY',authHeader:profile.auth==='api-key',models:[{id:profile.model,reasoning:profile.reasoning,input:profile.vision?['text','image']:['text'],contextWindow:profile.contextWindow,maxTokens:profile.maxTokens,cost:profile.pricing??{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}),{mode:0o600});
      modelEnv.CBIM_LLM_API_KEY=apiKey;
    }
    this.rpc=new PiRpc(event=>{
      this.events=this.events.then(()=>this.consume(event));
      void this.events.catch(error=>{this.fatal=error;this.settlement?.reject(error);void this.rpc?.close()});
    },error=>{if(!this.closing){this.fatal=error;this.settlement?.reject(error)}},message=>this.redact(message));
    const allowed=this.options.allowNativeExecution?'read,grep,find,ls,bash,write,edit,cbim_*':'read,grep,find,ls,cbim_*';
    this.rpc.start(this.options.process,context.task.root,[
      '--mode','rpc','--provider',this.options.provider,'--model',this.options.model,
      '--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-mcp',
      '--extension',extension,'--append-system-prompt',prompt,'--tools',allowed,
      '--session-dir',sessionDir,...(context.sessionFile?['--session',context.sessionFile]:['--session-id',context.task.taskId]),
    ],{...process.env,...modelEnv,PI_CODING_AGENT_DIR:configHome,CBIM_LOOP_BRIDGE_URL:this.bridge.url,CBIM_LOOP_BRIDGE_TOKEN:this.bridge.token});
    const initial=await this.rpc.request('get_state');
    if(initial.isStreaming||initial.pendingMessageCount)throw Error('Pi 会话已有未完成执行，拒绝覆盖');
    const thinking=requestedThinkingLevel(this.options.llm?.profile??{reasoning:initial.model?.reasoning===true});
    await this.rpc.request('set_thinking_level',{level:thinking});
    await this.rpc.request('set_auto_compaction',{enabled:true});
    await this.rpc.request('set_auto_retry',{enabled:true});
    const state=await this.rpc.request('get_state');
    // Pi get_state 不返回重试开关；重试以已成功的 RPC 回执为准，压缩另读回核对。
    if(state.autoCompactionEnabled!==true)throw Error('Pi 自动压缩未启用，拒绝发送');
    await context.emit({type:'engine.status',data:{label:'Pi 运行配置已应用',requestedThinking:thinking,thinkingLevel:state.thinkingLevel,contextWindow:state.model?.contextWindow,maxTokens:state.model?.maxTokens,workingContextWindow:this.options.llm?.profile.workingContextWindow,compactionPercent:this.options.llm?.profile.compactionPercent,autoCompaction:true,retry:buildPiRuntimeSettings().retry}});
    if(this.options.images?.length&&!state.model?.input?.includes('image'))throw Error('当前 Pi 模型未声明图片输入能力，请切换视觉模型');
    if(state.isStreaming||state.pendingMessageCount)throw Error('Pi 会话已有未完成执行，拒绝覆盖');
    if(!state.sessionFile||!state.sessionId)throw Error('Pi 未提供持久化会话身份');
    this.usageBaseline=await this.rpc.request('get_session_stats').catch(()=>undefined);
    await context.emit({type:'session.bound',data:{sessionId:state.sessionId,sessionFile:state.sessionFile,provider:this.options.provider,model:this.options.model}});
  }
  async run(message:string){
    if(!this.rpc||!this.context)throw Error('引擎未启动');if(this.fatal)throw this.fatal;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const settled=new Promise<{status:'completed'|'cancelled'|'failed';error?:string}>((resolve,reject)=>{
      this.settlement={resolve,reject};timer=setTimeout(()=>reject(Error('执行超时，结果需核实，不自动重放')),this.options.turnTimeoutMs??30*60*1000);
    });void settled.catch(()=>{});
    try{
      const accepted=await this.rpc.request('prompt',{message,...(this.options.images?.length?{images:this.options.images}:{})});
      if(accepted?.disposition!=='started')throw Error('Pi 没有启动本次任务，不能记为执行完成');
      const result=await settled;
      const stats=await this.rpc.request('get_session_stats').catch(()=>undefined);
      if(stats&&this.usageBaseline){
        const keys=['input','output','cacheRead','cacheWrite'];
        const tokens=Object.fromEntries(keys.map(key=>[key,stats.tokens?.[key]-this.usageBaseline!.tokens?.[key]]));
        const cost=stats.cost-this.usageBaseline.cost;
        if(Object.values(tokens).every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(cost)&&cost>=0)
          await this.context.emit({type:'engine.status',data:{label:'本轮用量已汇总',metric:'run-usage',tokens,cost,pricingKnown:!!this.options.llm?.profile.pricing}});
      }
      return result;
    }finally{if(timer)clearTimeout(timer);this.settlement=undefined}
  }
  private async consume(event:any){
    const emit=(e:EngineEvent)=>this.context!.emit(JSON.parse(this.redact(JSON.stringify(e))));
    switch(event.type){
      case 'message_start':if(event.message?.role==='assistant'){this.generationStarted=performance.now();this.activity='正在思考…';await emit({type:'engine.status',data:{metric:'activity',label:this.activity}})}return;
      case 'message_update':{
        const kind=event.assistantMessageEvent?.type;const activity=kind?.startsWith('thinking')?'正在思考…':kind?.startsWith('text')?'正在生成…':undefined;
        if(activity&&activity!==this.activity){this.activity=activity;await emit({type:'engine.status',data:{metric:'activity',label:activity}})}
        // 只转发公开文本增量；思维、工具参数增量不作为助手回复展示。
        if(event.assistantMessageEvent?.type==='text_delta')await emit({type:'message.delta',data:{text:event.assistantMessageEvent.delta}});return;}
      case 'message_end':
        if(event.message?.role==='assistant'){
          const message=event.message;
          const generationDurationMs=typeof message.duration==='number'&&Number.isFinite(message.duration)&&message.duration>0?message.duration:this.generationStarted===undefined?undefined:Math.max(0,performance.now()-this.generationStarted);
          this.generationStarted=undefined;
          const failure=modelStopError(message,this.options.llm?.profile.maxTokens,this.requestLimit);
          this.assistantError=failure?this.redact(failure):undefined;
          // Do not persist private reasoning. Authoritative final text replaces streaming deltas.
          await emit({type:'message',data:{role:'assistant',text:(message.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''),stopReason:message.stopReason,usage:message.usage,generationDurationMs,pricingKnown:this.options.llm?!!this.options.llm.profile.pricing:undefined}});
        }return;
      // 与 Cindy Pi 适配一致：工具进度、重试、压缩都不是终态，只有 settled 收口。
      case 'tool_execution_update':await emit({type:'tool.updated',data:{id:event.toolCallId,name:event.toolName,result:event.partialResult}});return;
      case 'auto_retry_start':await emit({type:'engine.status',data:{label:'模型连接重试中',attempt:event.attempt}});return;
      case 'auto_retry_end':await emit({type:'engine.status',data:{label:event.success?'模型连接已恢复':'模型重试已结束'}});return;
      case 'compaction_start':
      case 'auto_compaction_start':await emit({type:'engine.status',data:{label:'正在整理对话上下文',reason:event.reason}});return;
      case 'compaction_end':
      case 'auto_compaction_end':
        // 新版 Pi 使用 compaction_*；失败不能伪装成整理成功，重试仍由原生引擎负责。
        if(event.errorMessage&&!event.willRetry)this.assistantError=this.redact(String(event.errorMessage));
        await emit({type:'engine.status',data:{label:event.aborted?'上下文整理已取消':event.errorMessage?'上下文整理失败':'上下文整理结束',error:event.errorMessage,willRetry:event.willRetry}});return;
      case 'summarization_retry_scheduled':await emit({type:'engine.status',data:{label:'上下文摘要等待重试',attempt:event.attempt,delayMs:event.delayMs}});return;
      case 'summarization_retry_attempt_start':await emit({type:'engine.status',data:{label:'正在重试上下文摘要'}});return;
      case 'summarization_retry_finished':await emit({type:'engine.status',data:{label:'上下文摘要重试结束'}});return;
      case 'tool_execution_start':await emit({type:'tool.started',data:{id:event.toolCallId,name:event.toolName}});return;
      case 'tool_execution_end':await emit({type:'tool.finished',data:{id:event.toolCallId,name:event.toolName,isError:event.isError,result:event.result}});return;
      case 'agent_settled':
        this.settlement?.resolve(this.assistantError?{status:'failed',error:this.assistantError}:{status:this.stopped||event.aborted?'cancelled':'completed'});return;
      case 'extension_ui_request':
        // No implicit trust/approval fallback. Only our headless extension is intended to load.
        if(event.method==='confirm')this.rpc?.send({type:'extension_ui_response',id:event.id,confirmed:false});
        else if(['select','input','editor'].includes(event.method))this.rpc?.send({type:'extension_ui_response',id:event.id,cancelled:true});return;
    }
  }
  private redact(value:string){const key=this.options.llm?.apiKey;return key&&this.options.llm?.profile.auth==='api-key'?value.split(key).join('[REDACTED]'):value}
  /** Pi 原生 steer 在当前工具批次结束后处理；能力与权限沿用本次运行，不能借插入升级授权。 */
  async steer(message:string,images:import('../types').InputImage[]=[]){
    if(!this.rpc||!this.settlement||this.stopped||this.closing)throw Error('当前执行已结束，请继续队列');
    const state=await this.rpc.request('get_state');
    if(!state.isStreaming)throw Error('当前执行已结束，请继续队列');
    if(images.length&&!state.model?.input?.includes('image'))throw Error('当前运行的模型不支持图片，请保留在队列中由视觉模型执行');
    const result=await this.rpc.request('steer',{message,...(images.length?{images}:{})});
    if(result?.disposition!=='queued')throw Error('Pi 未确认接收插入消息，请核实执行记录后再继续');
  }
  async stop(){this.stopped=true;if(this.rpc)try{await this.rpc.request('abort',{},10000)}catch{await this.rpc.close()}}
  async close(){
    this.closing=true;
    try{await this.rpc?.close();await this.events}
    finally{await this.bridge?.close()}
  }
}
