/**
 * 受控文件边界：仅转发正式成员的工具与原 callId/取消信号；平台写入和补偿不会在 Pi 原生 write/edit 上自动附加。
 * 作用定位：Pi 引擎适配器，负责隔离配置、主对话与成员原生会话校验、工具桥与公开执行事件转换。
 * 设计原因：每轮冻结模型、权限和上下文；原生注册与能力预检共用 Core 工具表。成员求助/基线/检查点及按冻结要求提供的 JSON 验证沿真实调用 ID 入日志，结构拒绝不冒称通过；成员回传与人工决定用系统 custom 接续，结束只认 agent_settled。
 * 职责边界：不保存私有推理正文；记录实际用量与生成耗时，未知计价保持未知。明确停止后的标准取消文本才归为取消，其他错误及未知工具副作用交由运行时保留。
 * 插入边界：原生状态查询后再次核停止；只有 queued 回复表示已接收，发送后的失败不推断未执行或自动重发。
 * 主角色指引：内置执行角色也需明确岗位、模块负责人及独立采纳模型，提示不能把默认角色误写为绕过责任绑定的入口。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {AgentEngine,EngineContext,EngineEvent} from '../types';
import {PiRpc,type PiCommand} from './rpc';
import {openBridge,bridgeExtensionForSource,type KnowledgeBridge} from './bridge';
import type {ResolvedLlm} from '../llm/ports';
import {modelStopError} from '../model-errors';
import {buildPiRuntimeSettings,requestedThinkingLevel} from './runtime-config';
import {nativeToolNames} from '../../tools/native-tools';
import {fail} from '../../foundation/errors';

/** 单次 Pi 适配器配置；agentHome 只属于 CBIM 工作区，turnTimeoutMs 为回合等待上限毫秒。 */
export interface PiOptions {
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
}
/** 一次运行使用一个实例；启动失败也必须 close，以释放已创建的桥和子进程。 */
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
  /** 准备配置并核对原生会话，等待 session.bound 落盘后返回；不在此发送本轮提示。 */
  async start(context:EngineContext){
    this.context=context;
    await fs.mkdir(this.options.agentHome,{recursive:true});
    const sessionDir=path.join(this.options.agentHome,'sessions');await fs.mkdir(sessionDir,{recursive:true});
    if(context.sessionFile){
      if(!context.nativeSessionId)throw Error('Pi 恢复记录缺少原生会话身份，请核实原始记录或新建对话，不能猜测恢复');
      const file=await fs.realpath(context.sessionFile),root=await fs.realpath(sessionDir),rel=path.relative(root,file);
      if(rel.startsWith('..')||path.isAbsolute(rel)||!rel)throw Error('Pi 恢复文件不属于此 CBIM 工作区');
    }
    // 任务工具绑定真实运行日志；仅在内部 Loop 存在时注册，不借外部知识接口伪造任务身份。
    const taskNames=new Set((await context.taskTools?.list()??[]).map(t=>t.name));
    const helpNames=new Set((await context.memberHelpTools?.list()??[]).map(t=>t.name));
    const artifactNames=new Set((await context.artifactTools?.list()??[]).map(t=>t.name));
    const checkpointNames=new Set((await context.memberCheckpointTools?.list()??[]).map(t=>t.name));
    const controlledNames=new Set<string>((await context.controlledFileTools?.list()??[]).map(t=>t.name));
    const validationNames=new Set((await context.validationTools?.list()??[]).map(t=>t.name));
    const tools:KnowledgeBridge={list:async()=>[...await this.options.knowledge.list(),...await context.taskTools?.list()??[],...await context.memberHelpTools?.list()??[],...await context.artifactTools?.list()??[],...await context.memberCheckpointTools?.list()??[],...await context.validationTools?.list()??[],...await context.controlledFileTools?.list()??[]],call:(name,args,signal,toolCallId)=>controlledNames.has(name)?context.controlledFileTools!.call(name,args,toolCallId,signal):validationNames.has(name)?context.validationTools!.call(name,args,toolCallId):checkpointNames.has(name)?context.memberCheckpointTools!.call(name,args,toolCallId):artifactNames.has(name)?context.artifactTools!.call(name,args,toolCallId):helpNames.has(name)?context.memberHelpTools!.call(name,args,toolCallId):taskNames.has(name)?context.taskTools!.call(name,args):this.options.knowledge.call(name,args,signal,toolCallId)};
    this.bridge=await openBridge(tools,context.beforeTool,async usage=>{
      this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'上下文用量已更新',metric:'context',...usage}}));await this.events;
    },async limit=>{this.requestLimit=limit;this.events=this.events.then(()=>context.emit({type:'engine.status',data:{label:'模型请求额度',metric:'request-limit',maxTokens:limit}}));await this.events});
    const extension=path.join(context.directory,'cbim-extension.mjs'),prompt=path.join(context.directory,'instructions.md');
    // 业务上下文随任务持久化；执行恢复使用原快照，当前知识修改仍由服务校验版本。
    // 普通对话的用户文字与附件只经用户消息发送，不抬升为系统指引。
    const systemContext=context.task.mode==='chat'?{taskId:context.task.taskId,workspaceId:context.task.workspaceId,root:context.task.root,agentId:context.task.agentId}:context.task;
    const executionHint=context.task.mode==='chat'&&context.task.agentId==='cbim:main'?'\n本轮身份是主 Agent，负责调度和团队/业务知识管理。可通过 cbim_ 内部知识工具查询、预览和提交 .cbim 知识，知识写入遵循本轮 read/ask/execute 权限：只读时禁止写入，逐次询问时必须批准后提交，执行权限仍须通过版本与事务校验。主 Agent 不提供业务写入或命令执行（原生 write/edit/bash）；需要实现时，先查询模块负责岗位并保存匹配的目标计划，再通过 cbim_dispatch_task 交给执行 Agent。无专业角色时可登记内置 cbim:executor，但同样必须有明确项目岗位、模块负责人和独立采纳的可用模型，不能缺省派发或回退主模型。用户选择的权限也控制下游执行，不能解除主 Agent 的业务执行边界；不要把主 Agent 没有原生执行工具误报为工作区不可写或要求给主 Agent 提升业务权限。':this.options.allowNativeExecution?'\n本轮已提供 write/edit/bash 执行工具，可创建业务文件和运行验证。工具调用受 CBIM 策略及用户批准控制；业务写入与知识提交共用本轮权限，知识变更仍须通过 cbim_ 工具、版本检查和事务校验。':'\n本轮为只读模式，未提供 write/edit/bash。如需实现文件，请提示用户将输入框权限改为逐次询问或允许执行，再发送消息继续。';
    const helpHint=context.memberHelpTools?'\n作为执行成员，你不能再派发其它成员。遇到缺少信息、依赖、权限、能力或模块范围问题，先核实已有工具结果，再调用 cbim_task_help 向主调度提交结构化问题；可引用本轮已结束调用 ID。不要自己升级权限或请求恢复旧任务。求助成功只表示暂存，立即结束本轮，不能再调用工具、生成交付候选或声称完成；主调度会在本轮安全结束后重新安排新任务。':'';
    const checkpointHint=context.memberCheckpointTools?'\n本任务首轮可以申请一次 cbim_task_checkpoint 安全停泊。仅支持全部已成功 read/write/edit 触达文件均有完整基线的任务；执行过命令、动态目录查询、额外知识查询或未知操作不能使用。检查点请求后立即正常结束本轮；主调度显式预约后才可能沿原任务与上下文续执行一次，不能自行恢复、提权或把停泊当交付。':'';
    const validationHint=context.validationTools?'\n当前 Workflow 要求明确 JSON 产物结构验证。先读取文件并采集本轮基线，再通过 cbim_validation_run 选择冻结的 moduleId/requirementId 和 baselineId；不能提供路径、Schema 或通过结论。rejected 表示验证实际执行但结构不合格，工具成功回执不等于验证通过。修改文件后必须重新读取、采集和验证；只有当前字节匹配且所需验证均 passed 才能准备交付。结构合格仍不是业务目标或人工验收通过。':'';
    const instructions=this.options.prompt+executionHint+helpHint+checkpointHint+validationHint+(context.task.mode==='chat'?'\n\n当前工作区对话身份：\n':'\n\n任务定义与冻结的团队工作流上下文：\n')+JSON.stringify(systemContext,null,2);
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
      modelEnv.CBIM_LLM_API_KEY=apiKey;
    }
    await context.assertMemberResume?.();
    this.rpc=new PiRpc(event=>{
      this.events=this.events.then(()=>this.consume(event));
      void this.events.catch(error=>{this.fatal=error;this.settlement?.reject(error);void this.rpc?.close()});
    },error=>{if(!this.closing){this.fatal=error;this.settlement?.reject(error)}},message=>this.redact(message));
    const allowed=[...nativeToolNames(!!this.options.allowNativeExecution),'cbim_*'].join(',');
    // 禁止 Pi 自动加载用户机器上的外部连接；内部工具只由本次受控扩展注册。
    this.rpc.start(this.options.process,context.task.root,[
      '--mode','rpc','--provider',this.options.provider,'--model',this.options.model,
      '--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-mcp',
      '--extension',extension,'--append-system-prompt',prompt,'--tools',allowed,
      '--session-dir',sessionDir,...(context.sessionFile?['--session',context.sessionFile]:['--session-id',context.nativeSessionId??context.task.taskId]),
    ],{...process.env,...modelEnv,PI_CODING_AGENT_DIR:configHome,CBIM_LOOP_BRIDGE_URL:this.bridge.url,CBIM_LOOP_BRIDGE_TOKEN:this.bridge.token});
    const initial=await this.rpc.request('get_state');
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
  /** 发送本轮提示并等待 settled；超时抛错表示结果待核实，不自行重发提示或工具。 */
  async run(message:string){
    if(!this.rpc||!this.context)throw Error('引擎未启动');if(this.fatal)throw this.fatal;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const settled=new Promise<{status:'completed'|'cancelled'|'failed';error?:string}>((resolve,reject)=>{
      this.settlement={resolve,reject};timer=setTimeout(()=>reject(Error('执行超时，结果需核实，不自动重放')),this.options.turnTimeoutMs??30*60*1000);
    });void settled.catch(()=>{});
    try{
      // 内部回传通过本轮扩展写成 custom 消息，不作为原生 user 记录；加前缀避免正文被解析为斜杠命令。
      const continuation=this.context.source?.kind==='member-results'||this.context.source?.kind==='human_decisions';
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
          // Pi/provider 在已发起 abort 后有时仍用 error 返回标准取消文本；只归一这类明确取消，不掩盖普通模型错误。
          const cancelledMessage=this.stopped&&message.stopReason==='error'&&/^(?:AbortError:\s*)?(?:This operation was aborted|The operation was aborted|Request aborted|Aborted)\.?$/i.test(String(message.errorMessage??'').trim());
          const failure=cancelledMessage?undefined:modelStopError(message,this.options.llm?.profile.maxTokens,this.requestLimit);
          this.assistantError=failure?this.redact(failure):undefined;
          // Do not persist private reasoning. Authoritative final text replaces streaming deltas.
          await emit({type:'message',data:{role:'assistant',text:(message.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''),stopReason:cancelledMessage?'aborted':message.stopReason,usage:message.usage,generationDurationMs,pricingKnown:this.options.llm?!!this.options.llm.profile.pricing:undefined}});
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
  async steer(message:string,images:import('../types').InputImage[],signal:AbortSignal){
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
  async stop(){this.stopped=true;if(this.rpc)try{await this.rpc.request('abort',{},10000)}catch{await this.rpc.close()}}
  /** 关闭进程并排空已收到的事件；即使事件持久化失败也会关闭工具桥。 */
  async close(){
    this.closing=true;
    try{await this.rpc?.close();await this.events}
    finally{await this.bridge?.close()}
  }
}
