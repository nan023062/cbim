/**
 * 作用定位：将经过主进程接入的 action 路由到明确的工作区和应用服务。
 * 设计原因：通过 ApplicationServices 契约隔离应用实现；全局监管只暴露快照和游标读取，派发事实仍由明确工作区服务提交；IPC 操作清单与生命周期分离。
 */
import type {ApplicationServices} from './services';
import {ChatInputs} from '../persistence/tasks/chat-inputs';
import {fail} from '../../core/foundation/errors';
  /** 桌面 IPC 的操作路由；请求必须显式携带目标身份，不读取界面选中项。 */
export async function dispatchApplication(app:ApplicationServices,action:string,args:any={}){switch(action){
    case 'list':return app.list();
    case 'runtime.snapshot':return app.runtime.snapshot();
    case 'runtime.read':return app.runtime.read(args.cursor);
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
    case 'loop.prepare':return app.execution(args.id).prepare(args.task);
    case 'loop.choices':return app.execution(args.id).choices();
    case 'loop.thread':return app.execution(args.id).thread(args.taskId);
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
