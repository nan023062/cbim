/**
 * 作用定位：将经过主进程接入的 action 路由到明确的工作区和应用服务。
 * 设计原因：通过 ApplicationServices 隔离实现；人工保存不启动模型，humanContinue 只消费已保存决定。资料导入/取消独立于等待受理，IPC 不接收来源 proof 或仓库凭据。
 * 资源连接：桌面显式登记、授权与核验分别路由；只读原回执和未受理证明不重放知识提交，不接受客户端地址或令牌。
 * 模块治理：登记、观察、决定与独立实施按原命令路由；只有可信桌面闭包提供人工来源，普通 commit 没有批准参数。
 * 队列插入：原样传递用户操作时的 expectedRunId，由执行管理器统一拒绝缺省、过期或停止请求，不替客户端猜当前运行。
 * 岗位登记：五个桌面入口共享派发存储，提交者来源由主进程注入；登记状态不代表岗位已接入实际派发。
 */
import type {ApplicationServices} from './services';
import {ChatInputs} from '../persistence/tasks/chat-inputs';
import {ArchitectureService} from '../workspace/architecture-service';
import {WorkspacePackages} from '../resources/workspace-packages';
import {fail} from '../../core/foundation/errors';
  /** 桌面 IPC 的操作路由；请求必须显式携带目标身份，不读取界面选中项。 */
export async function dispatchApplication(app:ApplicationServices,action:string,args:any={}){switch(action){
    case 'workspace.members.list':return app.workspaceMembers(args.workspaceId).list(args);
    case 'workspace.members.get':return app.workspaceMembers(args.workspaceId).get(args);
    case 'workspace.members.preview':return app.workspaceMembers(args.workspaceId).preview(args);
    case 'workspace.members.receipt':return app.workspaceMembers(args.workspaceId).receipt(args);
    case 'workspace.members.commit':return app.workspaceMembers(args.workspaceId).commit(args,{kind:'local_desktop',interaction:'explicit_submit'});
    case 'governance.list':return app.governance(args.workspaceId).list(args);
    case 'governance.receipt':return app.governance(args.workspaceId).lookup(args);
    case 'governance.unaccepted':return app.governance(args.workspaceId).unaccepted(args);
    // 主 Frame 已由 Electron 核实；本机明确操作不冒充认证负责人，模型工具没有这些入口。
    case 'governance.register':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未登记保护');return app.governance(args.workspaceId).register(args,{kind:'local_desktop',interaction:'explicit_submit'});
    case 'governance.observe':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存观察');return app.governance(args.workspaceId).observe(args);
    case 'governance.propose':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存提案');return app.governance(args.workspaceId).propose(args);
    case 'governance.decide':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存决定');return app.governance(args.workspaceId).decide(args,{kind:'local_desktop',interaction:'explicit_submit'});
    case 'governance.apply':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存实施意图');return app.governance(args.workspaceId).apply(args);
    case 'list':return app.list();
    case 'runtime.snapshot':return app.runtime.snapshot();
    case 'runtime.read':return app.runtime.read(args.cursor);
    case 'admission.read':return app.admission.read(args.cursor);
    case 'admission.settings':return app.admissionSettings.read();
    case 'admission.configure':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出');return app.admissionSettings.configure(args);
    case 'budget.settings':return app.budgetSettings.read();
    case 'budget.configure':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出');return app.budgetSettings.configure(args);
    case 'agentHistory.roles':return app.agentHistory(args.workspaceId).roles(args);
    case 'agentHistory.sessions':return app.agentHistory(args.workspaceId).sessions(args);
    case 'agentHistory.runs':return app.agentHistory(args.workspaceId).runs(args);
    case 'agentHistory.events':return app.agentHistory(args.workspaceId).events(args);
    case 'models.list':return app.models.list();
    case 'models.save':return app.models.save(args);
    case 'models.select':return app.models.select(args.id);
    case 'models.remove':return app.models.remove(args.id);
    case 'models.test':return app.models.test(args.id,args.modelId);
    case 'models.discover':return app.models.discover(args);
    case 'models.discoverDetails':return app.models.discoverDetails(args);
    case 'dispatch.open':return app.memberDispatch(args.workspaceId).openGraph(args);
    case 'dispatch.memberCreate':return app.memberDispatch(args.workspaceId).createMember(args);
    case 'dispatch.task':return app.memberDispatch(args.workspaceId).dispatchTask(args);
    case 'dispatch.graphSnapshot':return app.memberDispatch(args.identity?.workspaceId).snapshot(args.identity);
    case 'dispatch.graphDelta':return app.memberDispatch(args.identity?.workspaceId).delta(args.identity,args.cursor,args.limit);
    case 'dispatch.sessionRead':return app.memberDispatch(args.identity?.workspaceId).sessionRead(args);
    case 'dispatch.scopeUsage':return app.memberDispatch(args.workspaceId).usage.read(args);
    case 'dispatch.executionStart':return app.memberExecution(args.workspaceId).start(args);
    case 'dispatch.executionStop':return app.memberExecution(args.workspaceId).stop(args);
    case 'dispatch.executionInspect':return app.memberExecution(args.workspaceId).inspect(args);
    case 'dispatch.executionReport':return app.memberExecution(args.workspaceId).report(args);
    case 'dispatch.artifactReport':return app.memberExecution(args.workspaceId).artifactReport(args);
    case 'dispatch.replans.preview':return app.memberDispatch(args.workspaceId).replans.preview(args);
    case 'dispatch.humanPreview':return app.memberDispatch(args.workspaceId).humanDecisions.preview(args);
    case 'dispatch.humanReceipt':return app.memberDispatch(args.workspaceId).humanDecisions.inspect(args);
    case 'dispatch.humanHistory':return app.memberDispatch(args.workspaceId).humanDecisions.history(args);
    // 发送窗口/主 Frame 已由 Electron 接入核验。标记只代表本机明确提交，不宣称认证账号；模型工具表没有此入口。
    case 'dispatch.humanDecide':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存新的人工决定');return app.memberDispatch(args.workspaceId).humanDecisions.decide(args,{kind:'local_desktop',interaction:'explicit_submit'});
    case 'dispatch.executionEvents':return app.memberExecution(args.workspaceId).events(args);
    case 'dispatch.messages':return app.memberExecution(args.workspaceId).messages(args);
    case 'dispatch.acknowledge':return app.memberExecution(args.workspaceId).acknowledge(args);
    case 'dispatch.approvals':return app.memberExecution(args.workspaceId).pendingApprovals(args);
    case 'dispatch.approve':{const {approvalId,allow,allowAll,...identity}=args;return app.memberExecution(identity.workspaceId).answerApproval(identity,approvalId,allow,allowAll===true)}
    case 'dispatch.questions':return app.memberExecution(args.workspaceId).pendingQuestions(args);
    case 'dispatch.answerQuestion':{const {questionId,answers,...identity}=args;return app.memberExecution(identity.workspaceId).answerQuestion(identity,questionId,answers)}
    case 'loop.prepare':return app.execution(args.id).prepare(args.task);
    case 'loop.choices':return app.execution(args.id).choices();
    case 'loop.thread':return app.execution(args.id).thread(args.taskId);
    case 'loop.threadView':return app.execution(args.id).threadView(args.taskId);
    case 'loop.start':return app.execution(args.id).start(args.task,await app.modelOptions(args.options));
    case 'loop.queue':return app.execution(args.id).queued(args.taskId);
    case 'loop.queueDelta':return app.execution(args.id).queueDelta(args.taskId,args.cursor);
    case 'loop.enqueue':return app.execution(args.id).enqueue(args.taskId,await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments));
    case 'loop.queueChange':return app.execution(args.id).changeQueued(args.taskId,args.queueId,args.action);
    case 'loop.queueEdit':return app.execution(args.id).editQueued(args.taskId,args.queueId,args.message,args.expected);
    case 'loop.queueMove':return app.execution(args.id).moveQueued(args.taskId,args.queueId,args.beforeId);
    case 'loop.queueInsert':return app.execution(args.id).insertQueued(args.taskId,args.queueId,args.expectedRunId);
    case 'loop.queueContinue':return app.execution(args.id).continueQueue(args.taskId);
    case 'loop.chat':return app.execution(args.id).chat(await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments));
    case 'loop.resume':return app.execution(args.id).resume(args.taskId,args.runId,await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments),args.reconciledToolIds);
    case 'loop.goalContinue':return app.execution(args.workspaceId).continueGoal(args);
    case 'loop.goalContinuation':return app.memberDispatch(args.workspaceId).continuations.inspect(args);
    case 'loop.humanContinue':return app.execution(args.workspaceId).continueFromHumanDecisions(args);
    case 'loop.humanContinuation':return app.memberDispatch(args.workspaceId).humanContinuations.inspect(args);
    case 'loop.recoveryStart':return app.execution(args.workspaceId).recoverExecution(args);
    case 'loop.recoveryReceipt':return app.memberDispatch(args.workspaceId).recoveries.inspect(args);
    case 'loop.replanStart':return app.execution(args.workspaceId).replanExecution(args);
    case 'loop.replanReceipt':return app.memberDispatch(args.workspaceId).replans.inspect(args);
    case 'chat.attach':return new ChatInputs(app.workspace(args.id)).add(args.attachment);
    case 'chat.materialTargets':return app.chatMaterials.targets(args);
    case 'chat.materialList':return app.chatMaterials.list(args);
    case 'chat.import':return app.chatMaterials.import(args);
    case 'chat.importCancel':return app.chatMaterials.cancel(args);
    case 'chat.connectors':return new ChatInputs(app.workspace(args.id)).connectors();
    case 'chat.preview':return new ChatInputs(app.workspace(args.id)).preview(args.attachmentId);
    case 'loop.questions':return app.execution(args.id).pendingQuestions(args.taskId);
    case 'loop.answerQuestion':return app.execution(args.id).answerQuestion(args.taskId,args.questionId,args.answers);
    case 'loop.approvals':return app.execution(args.id).pendingApprovals(args.taskId);
    case 'loop.approve':return app.execution(args.id).answerApproval(args.taskId,args.approvalId,args.allow,args.allowAll===true);
    case 'loop.stop':return app.execution(args.id).stop(args.taskId);
    case 'loop.inspect':return app.execution(args.id).inspect(args.taskId,args.runId);
    case 'loop.list':return app.execution(args.id).list();
    case 'resources.status':return app.resources.status();
    case 'resources.configure':return app.resources.configure(args);
    case 'resources.list':return app.resources.read();
    case 'resources.save':return app.resources.save(args);
    case 'resources.remove':return app.resources.remove(args);
    case 'resources.share':return app.resources.startSharing(args);
    case 'resources.stopSharing':return app.resources.stopSharing();
    case 'resources.connection':return app.resources.connection();
    case 'resources.connection.list':return app.repositoryConnections.list(args);
    case 'resources.connection.preview':return app.repositoryConnections.preview(args);
    case 'resources.connection.commit':return app.repositoryConnections.commit(args);
    case 'resources.connection.commitReceipt':return app.repositoryConnections.commitReceipt(args);
    case 'resources.connection.unaccepted':return app.repositoryConnections.unaccepted(args);
    // 仅已核实主 Frame 的明确桌面操作；知识工具、链接器定义或模型不能自行授予权限。
    case 'resources.connection.grant':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，未保存新授权');return app.repositoryConnections.grant(args);
    case 'resources.connection.revoke':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出，请重开后核实授权');return app.repositoryConnections.revoke(args);
    case 'resources.connection.check':return app.repositoryConnections.check(args);
    case 'resources.connection.receipt':return app.repositoryConnections.receipt(args);
    // 静态定义编辑/复用只绑定工作区身份；不创建成员实例，也不触碰主会话任务图。
    case 'architecture.preview':return new ArchitectureService(app.workspace(args.workspaceId)).preview(args);
    case 'architecture.commit':return new ArchitectureService(app.workspace(args.workspaceId)).commit(args);
    case 'resources.publishWorkspace':return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).publish(args);
    case 'resources.importPreview':return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).preview(args);
    case 'resources.importCommit':return new WorkspacePackages(app.workspace(args.workspaceId),app.resources).commit(args);
    case 'add':{if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出');const entry=await app.catalog.add(args.path);try{await app.open(entry.id)}catch{/* report the registered workspace's failed state in list */}return entry}
    case 'open':return (await app.open(args.id)).view();
    case 'rename':{const entry=await app.catalog.rename(args.id,args.name);const ws=app.running.get(args.id);if(ws)ws.entry.name=entry.name;app.runtime.rename(args.id,entry.name);return entry}
    case 'remove':return app.remove(args.id);
    case 'relocate':{const entry=await app.catalog.relocate(args.id,args.path,args.confirm===true);if(entry.id!==args.id)await app.stop(args.id);await app.open(entry.id);return entry}
    case 'snapshot':return app.workspace(args.id).snapshot();
    case 'preview':return app.workspace(args.workspaceId).preview(args);
    case 'commit':return app.workspace(args.workspaceId).commit(args);
    case 'movePreview':{const ws=app.workspace(args.id);return ws.preview(await ws.planMove(await ws.read(),args.from,args.to))}
    case 'task':if(!['validate','reindex'].includes(args.name))fail('TOOL','不支持的工具');return app.workspace(args.id).startTask(args.name);
    case 'cancelTask':return app.workspace(args.id).cancelTask(args.taskId);
    case 'local':if(!['memory','task-records','logs'].includes(args.kind))fail('TYPE','未知本地数据类型');return app.workspace(args.id).localData(args.kind);
    default:fail('ACTION','未知操作');
  }}
