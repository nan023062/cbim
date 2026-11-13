/**
 * 目录归属：backend/engines/pi；Pi 引擎适配。

 * 冻结范围工具由Runtime提供；该模式原生文件/命令清单为空，未知原生调用仍由Runtime拒绝，范围工具沿原调用ID与停止信号转发。
 * 检查点提示跟随当前运行实际注册的工具和剩余额度，不把续执行固定限制为只能交付。
 * 受控文件边界：仅转发正式成员的写入及冻结删除/移动工具与原 callId/取消信号；平台操作证明和补偿不会在 Pi 原生 write/edit 上自动附加。
 * 作用定位：Pi 引擎适配器，负责隔离配置、原生会话校验及事件转换；成员回传、人工决定和目标返工均走可信系统输入。
 * 能力边界：是否关闭原生工具由可信能力策略决定，不依赖具体业务工具名称。
 * 设计原因：每轮冻结模型、权限和上下文；原生注册与能力预检共用 Core 工具表。成员求助/基线/检查点及按冻结要求提供的产物验证沿真实调用 ID 入日志，结构拒绝不冒称通过；成员回传与人工决定用系统 custom 接续，结束只认 agent_settled。
 * 职责边界：不保存私有推理正文；记录实际用量与生成耗时，未知计价保持未知。工具清单日志区分宿主准备与 Pi 实际活动清单，只保存名称和缺失项。明确停止后的标准取消文本才归为取消，其他错误及未知工具副作用交由运行时保留。
 * 插入边界：原生状态查询后再次核停止；只有 queued 回复表示已接收，发送后的失败不推断未执行或自动重发。
 * 展示顺序：完整公开回复只附带本消息内的 toolCallIds，供 UI 处理工具 HTTP 门禁与 stdout 文字的到达竞态，不重写日志顺序或授予执行权。
 * 主角色指引：与 Claude Code 共用 engine-instructions；未配置自定义岗位的模块由主 Agent 直接执行，默认执行角色已退役。
 * 请求预算：可信端口启用时，启动前安装父进程代理；终态与工具授权都受可靠结算屏障约束，停止先结束实际请求。
 * 受管包的 CLI 路径在上层冻结到 process 参数；会话包身份由外层包装器核对，本适配器继续只负责 Pi 协议。
 * 超时窗口按模型增量及工具实际进展续期；重试通知不续期，停止和关闭释放本轮计时器。
 */
import type {EngineRuntimePackage} from '../../core/execution/engine-runtime';
import fs from 'node:fs/promises';
import {runtimeEngineTools,nativeToolsDisabled} from '../../core/execution/engine-tools';
import {engineInstructions} from '../../core/execution/engine-instructions';
import path from 'node:path';
import type {AgentEngine,EngineContext,EngineEvent} from '../../core/execution/types';
import {PiRpc,type PiCommand} from './rpc';
import {openBridge,bridgeExtensionForSource,type KnowledgeBridge} from './bridge';
import type {ResolvedLlm} from '../../core/models/ports';
import {modelStopError} from '../../core/execution/model-errors';
import {buildPiRuntimeSettings,requestedThinkingLevel} from './runtime-config';
import {nativeToolNames} from '../../core/tools/native-tools';
import {fail} from '../../core/foundation/errors';
import {pathToFileURL} from 'node:url';
import type {RequestBudgetPort} from '../../core/models/request-budget';
import {openRequestBudgetTransport} from '../transport/request-budget-transport';
import {requestBudgetBootstrap} from './request-budget-bootstrap';
import {RunInactivityTimer} from '../run-inactivity';

/** 单次 Pi 适配器配置；agentHome 只属于 CBIM 工作区，turnTimeoutMs 为连续无进展上限毫秒。 */
export interface PiOptions {
  /** 共用引擎装配携带的包身份；Pi 实际启动入口已由 process 固定。 */
  runtime?:EngineRuntimePackage;nativeToolsRuntime?:EngineRuntimePackage;
  process:PiCommand;
  provider:string;
  model:string;
  /** CBIM 工作区专用的引擎目录，不能复用用户外部 Pi 配置目录。 */
  agentHome:string;
  prompt:string;
  knowledge:KnowledgeBridge;
  allowNativeExecution?:boolean;
  turnTimeoutMs?:number;
  /** 仅本次进程装配使用；凭据通过环境注入，不写入指引、模型文件或事件。 */
  llm?:ResolvedLlm;
  /** 本轮用户明确附加的图片快照；经主进程读取，不作为系统指令。 */
  images?:{type:'image';data:string;mimeType:string}[];
  /** 在 beforeRun 登记后读取冻结策略；仅可信装配工厂提供，不能作为模型或 IPC 参数。 */
  requestBudget?():Promise<RequestBudgetPort|undefined>;
}
/** 一次运行使用一个实例；启动失败也必须 close，以释放已创建的桥和子进程。 */
export class PiEngine implements AgentEngine {
  readonly kind='pi';
  private context?:EngineContext;
  private rpc?:PiRpc;
  private bridge?:Awaited<ReturnType<typeof openBridge>>;
  private budgetTransport?:Awaited<ReturnType<typeof openRequestBudgetTransport>>;
  private events:Promise<void>=Promise.resolve();
  private settlement?:{resolve:(value:{status:'completed'|'cancelled'|'failed';error?:string})=>void;reject:(error:Error)=>void};
  private inactivity?:RunInactivityTimer;
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
  /** 准备配置并核对原生会话，等待 session.bound 落盘后返回；不在此发送本轮提示。 */
  async start(context:EngineContext){
    this.context=context;
    const requestBudget=await this.options.requestBudget?.();
    if(requestBudget){if(!this.options.llm)throw Error('逐请求预算缺少可信模型');this.budgetTransport=await openRequestBudgetTransport(this.options.llm,requestBudget)}
    await fs.mkdir(this.options.agentHome,{recursive:true});
    const sessionDir=path.join(this.options.agentHome,'sessions');await fs.mkdir(sessionDir,{recursive:true});
    if(context.sessionFile){
      if(!context.nativeSessionId)throw Error('Pi 恢复记录缺少原生会话身份，请核实原始记录或新建对话，不能猜测恢复');
      const file=await fs.realpath(context.sessionFile),root=await fs.realpath(sessionDir),rel=path.relative(root,file);
      if(rel.startsWith('../../core/execution')||path.isAbsolute(rel)||!rel)throw Error('Pi 恢复文件不属于此 CBIM 工作区');
    }
    const tools=await runtimeEngineTools(context,this.options.knowledge);
    this.bridge=await openBridge(tools,call=>this.budgetTransport?.error()?Promise.resolve({allow:false,reason:this.budgetTransport.error()}):context.beforeTool(call),async usage=>{
      this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'上下文用量已更新',metric:'context',...usage}}));await this.events;
    },async limit=>{this.requestLimit=limit;this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'模型请求额度',metric:'request-limit',maxTokens:limit}}));await this.events},async catalog=>{
      this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:catalog.missing.length?'工具装配不完整':'活动工具已核对',metric:'tool-catalog',stage:'active',...catalog,...(catalog.missing.length?{code:'TOOL_CATALOG_MISMATCH'}:{})}}));await this.events;
    });
    await context.emit({type:'engine.status',data:{label:'宿主工具清单已准备',metric:'tool-catalog',stage:'prepared',expected:this.bridge.tools.map(tool=>tool.name).sort()}});
    const extension=path.join(context.directory,'cbim-extension.mjs'),prompt=path.join(context.directory,'instructions.md');
    // 业务上下文随任务持久化；执行恢复使用原快照，当前知识修改仍由服务校验版本。
    // 普通对话的用户文字与附件只经用户消息发送，不抬升为系统指引。
    const instructions=engineInstructions(context,this.options.prompt,!!this.options.allowNativeExecution);
    await fs.writeFile(extension,bridgeExtensionForSource(context.source),{mode:0o600});await fs.writeFile(prompt,instructions,{mode:0o600});
    // 所有运行拥有独立设置，CLI 的模型目录也只复制快照，避免并发互相覆盖。
    const configHome=path.join(context.directory,'provider');await fs.mkdir(configHome,{recursive:true});
    if(!this.options.llm){try{await fs.copyFile(path.join(this.options.agentHome,'models.json'),path.join(configHome,'models.json'))}catch(e:any){if(e.code!=='ENOENT')throw e}}
    await fs.writeFile(path.join(configHome,'settings.json'),JSON.stringify(buildPiRuntimeSettings(this.options.llm?.profile)),{mode:0o600});
    const modelEnv:NodeJS.ProcessEnv={};
    if(this.options.llm){
      const {profile,apiKey}=this.options.llm;
      // 每次运行独立配置，切换设置不会覆盖其他正在执行的模型；会话仍在工作区目录。
      await fs.writeFile(path.join(configHome,'models.json'),JSON.stringify({providers:{[this.options.provider]:{baseUrl:profile.baseUrl,api:profile.api,apiKey:'$CBIM_LLM_API_KEY',authHeader:profile.auth==='api-key',models:[{id:profile.model,reasoning:profile.reasoning,input:profile.vision?['text','image']:['text'],contextWindow:profile.contextWindow,maxTokens:profile.maxTokens,cost:profile.pricing??{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}),{mode:0o600});
      modelEnv.CBIM_LLM_API_KEY=this.budgetTransport?'cbim-parent-request-gate':apiKey;
    }
    await context.assertMemberResume?.();
    this.rpc=new PiRpc(event=>{
      this.events=this.events.then(()=>this.consume(event));
      void this.events.catch(error=>{this.fatal=error;this.settlement?.reject(error);void this.rpc?.close()});
    },error=>{if(!this.closing){this.fatal=error;this.settlement?.reject(error)}},message=>this.redact(message));
    const allowed=[...(nativeToolsDisabled(context)?[]:nativeToolNames(!!this.options.allowNativeExecution)),'cbim_*'].join(',');
    // 禁止 Pi 自动加载用户机器上的外部连接；内部工具只由本次受控扩展注册。
    let command=this.options.process;
    if(this.budgetTransport){
      const bootstrap=path.join(context.directory,'cbim-request-budget.mjs');
      await fs.writeFile(bootstrap,requestBudgetBootstrap({endpoint:this.budgetTransport.endpoint,proxy:this.budgetTransport.url,token:this.budgetTransport.token,bridge:this.bridge.url}),{mode:0o600});
      command={...command,args:['--import',pathToFileURL(bootstrap).href,...command.args],env:{...command.env,CBIM_LLM_API_KEY:modelEnv.CBIM_LLM_API_KEY}};
    }
    this.rpc.start(command,context.task.root,[
      '--mode','rpc','--provider',this.options.provider,'--model',this.options.model,
      '--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-mcp',
      '--extension',extension,'--append-system-prompt',prompt,'--tools',allowed,
      '--session-dir',sessionDir,...(context.sessionFile?['--session',context.sessionFile]:['--session-id',context.nativeSessionId??context.task.taskId]),
    ],{...process.env,...modelEnv,PI_CODING_AGENT_DIR:configHome,CBIM_LOOP_BRIDGE_URL:this.bridge.url,CBIM_LOOP_BRIDGE_TOKEN:this.bridge.token});
    const initial=await this.rpc.request('get_state');
    this.budgetTransport?.assertReady();
    if(context.nativeSessionId&&initial.sessionId!==context.nativeSessionId)throw Error(context.memberBinding?'Pi 原生会话身份与当前成员通道不一致':'Pi 原生会话身份与原对话记录不一致');
    if(initial.isStreaming||initial.pendingMessageCount)throw Error('Pi 会话已有未完成执行，拒绝覆盖');
    // 载入不得悄悄修复或改写检查点历史；在本轮配置和输入写入前再次核实受管字节。
    await context.assertMemberResume?.();
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
  /** 等待 settled；输出和工具进展续期，连续静默才中断，不自行重发提示或工具。 */
  async run(message:string){
    if(!this.rpc||!this.context)throw Error('引擎未启动');if(this.fatal)throw this.fatal;
    const settled=new Promise<{status:'completed'|'cancelled'|'failed';error?:string}>((resolve,reject)=>{
      this.settlement={resolve,reject};this.inactivity=new RunInactivityTimer(this.options.turnTimeoutMs,'Pi',reject);
    });void settled.catch(()=>{});
    try{
      // 内部回传通过本轮扩展写成 custom 消息，不作为原生 user 记录；加前缀避免正文被解析为斜杠命令。
      const continuation=this.context.source?.kind==='member-results'||this.context.source?.kind==='human_decisions'||this.context.source?.kind==='goal-repair';
      const label=this.context.source?.kind==='human_decisions'?'CBIM 人工决定系统转交\n':'CBIM 成员执行回传\n';
      const accepted=await this.rpc.request('prompt',{message:continuation?label+message:message,...(!continuation&&this.options.images?.length?{images:this.options.images}:{})});
      if(accepted?.disposition!==(continuation?'handled':'started'))throw Error('Pi 没有按本轮输入来源启动任务，不能记为执行完成');
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
    }finally{this.inactivity?.dispose();this.settlement=undefined}
  }
  private async consume(event:any){
    // 推理/参数增量只作为活性信号，既不记录正文，也不依赖 UI 状态文字是否变化。
    if(event.type==='message_update'&&['thinking_delta','text_delta','toolcall_delta'].includes(event.assistantMessageEvent?.type)&&typeof event.assistantMessageEvent.delta==='string'&&event.assistantMessageEvent.delta.length)this.inactivity?.progress();
    const emit=(e:EngineEvent)=>{this.inactivity?.observe(e);return this.context!.emit(JSON.parse(this.redact(JSON.stringify(e))))};
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
          // Pi/provider 在已发起 abort 后有时仍用 error 返回标准取消文本；只归一这类明确取消，不掩盖普通模型错误。
          const cancelledMessage=this.stopped&&message.stopReason==='error'&&/^(?:AbortError:\s*)?(?:This operation was aborted|The operation was aborted|Request aborted|Aborted)\.?$/i.test(String(message.errorMessage??'').trim());
          const failure=cancelledMessage?undefined:modelStopError(message,this.options.llm?.profile.maxTokens,this.requestLimit);
          this.assistantError=failure?this.redact(failure):undefined;
          // HTTP 工具门禁可能先于已排队的 stdout 文字落盘；只保留本回复的调用 ID，供界面还原因果顺序，不保存思维或工具参数。
          const toolCallIds=(message.content||[]).filter((x:any)=>x.type==='toolCall'&&typeof x.id==='string').map((x:any)=>x.id);
          await emit({type:'message',data:{role:'assistant',text:(message.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''),...(toolCallIds.length?{toolCallIds}:{}),stopReason:cancelledMessage?'aborted':message.stopReason,usage:message.usage,generationDurationMs,pricingKnown:this.options.llm?!!this.options.llm.profile.pricing:undefined}});
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
        {const error=this.budgetTransport?.error()??this.assistantError;this.settlement?.resolve(error?{status:'failed',error}:{status:this.stopped||event.aborted?'cancelled':'completed'});return;}
      case 'extension_error':
        // custom 启动由扩展异步触发，失败必须结束等待，不能把 handled 当成模型已完成。
        if(this.context?.source){this.fatal=Error(this.redact(String(event.error||'成员结果接续扩展失败')));this.settlement?.reject(this.fatal)}return;
      case 'extension_ui_request':
        // No implicit trust/approval fallback. Only our headless extension is intended to load.
        if(event.method==='confirm')this.rpc?.send({type:'extension_ui_response',id:event.id,confirmed:false});
        else if(['select','input','editor'].includes(event.method))this.rpc?.send({type:'extension_ui_response',id:event.id,cancelled:true});return;
    }
  }
  private redact(value:string){const key=this.options.llm?.apiKey;return key&&this.options.llm?.profile.auth==='api-key'?value.split(key).join('[REDACTED]'):value}
  /** 发送前取消可明确拒绝；发送后只认原回复，停止不能把 queued 改写成未接收。 */
  async steer(message:string,images:import('../../core/execution/types').InputImage[],signal:AbortSignal){
    const assertReady=()=>{
      if(signal.aborted||this.stopped||this.closing)fail('QUEUE_INSERT_STOPPED','当前运行已停止插入，原消息仍保留在队列');
      if(!this.rpc||!this.settlement)fail('QUEUE_INSERT_STALE','原主运行已结束，原消息仍保留在队列');
    };
    assertReady();const rpc=this.rpc!;
    const state=await rpc.request('get_state');
    assertReady();
    if(!state.isStreaming)fail('QUEUE_INSERT_STALE','原主运行已结束，原消息仍保留在队列');
    if(images.length&&!state.model?.input?.includes('image'))throw Error('当前运行的模型不支持图片，请保留在队列中由视觉模型执行');
    try{
      const result=await rpc.request('steer',{message,...(images.length?{images}:{})});
      if(result?.disposition!=='queued')throw Error('unconfirmed');
    }catch{fail('QUEUE_INSERT_UNKNOWN','插入结果未确认，队列将保持暂停，请先核实原运行记录，勿重复发送')}
  }
  /** 先保留停止意图，再请求原生 abort；请求失败则关闭进程，最终结算由 LoopRuntime 完成。 */
  async stop(){this.stopped=true;this.inactivity?.dispose();await this.budgetTransport?.close();if(this.rpc)try{await this.rpc.request('abort',{},10000)}catch{await this.rpc.close()}}
  /** 关闭进程并排空已收到的事件；即使事件持久化失败也会关闭工具桥。 */
  async close(){
    this.closing=true;this.inactivity?.dispose();
    try{await this.budgetTransport?.close();await this.rpc?.close();await this.events}
    finally{await this.bridge?.close()}
  }
}
