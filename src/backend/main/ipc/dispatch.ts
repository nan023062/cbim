/**
 * 作用定位：将经过主进程接入的 action 路由到明确的工作区和应用服务。
 * 设计原因：通过 ApplicationServices 契约隔离应用实现；全局配额只公开观察与可靠设置，不能经 IPC 领取名额。目标补充、核实和业务重规划各自保持明确身份及受理边界。
 */
import type {ApplicationServices} from './services';
import {ChatInputs} from '../persistence/tasks/chat-inputs';
import {ArchitectureService} from '../workspace/architecture-service';
import {WorkspacePackages} from '../resources/workspace-packages';
import {fail} from '../../core/foundation/errors';
  /** 桌面 IPC 的操作路由；请求必须显式携带目标身份，不读取界面选中项。 */
export async function dispatchApplication(app:ApplicationServices,action:string,args:any={}){switch(action){
    case 'list':return app.list();
    case 'runtime.snapshot':return app.runtime.snapshot();
    case 'runtime.read':return app.runtime.read(args.cursor);
    case 'admission.read':return app.admission.read(args.cursor);
    case 'admission.settings':return app.admissionSettings.read();
    case 'admission.configure':if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出');return app.admissionSettings.configure(args);
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
    case 'dispatch.executionStart':return app.memberExecution(args.workspaceId).start(args);
    case 'dispatch.executionStop':return app.memberExecution(args.workspaceId).stop(args);
    case 'dispatch.executionInspect':return app.memberExecution(args.workspaceId).inspect(args);
    case 'dispatch.executionReport':return app.memberExecution(args.workspaceId).report(args);
    case 'dispatch.replans.preview':return app.memberDispatch(args.workspaceId).replans.preview(args);
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
    case 'loop.queueInsert':return app.execution(args.id).insertQueued(args.taskId,args.queueId);
    case 'loop.queueContinue':return app.execution(args.id).continueQueue(args.taskId);
    case 'loop.chat':return app.execution(args.id).chat(await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments));
    case 'loop.resume':return app.execution(args.id).resume(args.taskId,args.runId,await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments),args.reconciledToolIds);
    case 'loop.goalContinue':return app.execution(args.workspaceId).continueGoal(args);
    case 'loop.goalContinuation':return app.memberDispatch(args.workspaceId).continuations.inspect(args);
    case 'loop.recoveryStart':return app.execution(args.workspaceId).recoverExecution(args);
    case 'loop.recoveryReceipt':return app.memberDispatch(args.workspaceId).recoveries.inspect(args);
    case 'loop.replanStart':return app.execution(args.workspaceId).replanExecution(args);
    case 'loop.replanReceipt':return app.memberDispatch(args.workspaceId).replans.inspect(args);
    case 'chat.attach':return new ChatInputs(app.workspace(args.id)).add(args.attachment);
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
