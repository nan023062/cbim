/**
 * 作用定位：成员派发、运行核实与人工处置的主进程处理器。
 * 设计原因：scope 与原命令身份由请求明确选择，写入来源仅由桌面闭包注入，服务继续裁决权限与并发。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../contracts/ipc-call';
import type {DispatchIpcResponses} from '../../contracts/ipc-dispatch';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function dispatchIpcHandlers(app:ApplicationServices):IpcHandlers<keyof DispatchIpcResponses>{
  return {
    'dispatch.isolatedExecutionReport':async args=>{return app.isolatedExecutions(args.workspaceId).report(args);},
    'dispatch.isolatedExecutionCleanup':async args=>{return app.isolatedExecutions(args.workspaceId).cleanup(args);},
    'dispatch.controlledFileReport':async args=>{return app.controlledFiles(args.workspaceId).report(args);},
    'dispatch.fileCompensationPreview':async args=>{return app.controlledFiles(args.workspaceId).preview(args);},
    'dispatch.fileCompensate':async args=>{return app.controlledFiles(args.workspaceId).compensate(args);},
    'dispatch.fileCompensationReceipt':async args=>{return app.controlledFiles(args.workspaceId).receipt(args);},
    'dispatch.open':async args=>{return app.memberDispatch(args.workspaceId).openGraph(args);},
    'dispatch.memberCreate':async args=>{return app.memberDispatch(args.workspaceId).createMember(args);},
    'dispatch.task':async args=>{const {scopeId,...request}=args;return app.memberDispatch(args.workspaceId).dispatchTask(request,scopeId)},
    'dispatch.ownerInspect':async args=>{return app.memberDispatch(args.workspaceId).ownerInspect(args);},
    'dispatch.commandReport':async args=>{return app.memberDispatch(args.workspaceId).commandReport(args);},
    'dispatch.effectObserve':async args=>{return app.memberDispatch(args.workspaceId).effects.observe(args);},
    'dispatch.effectDispositionList':async args=>{return app.memberDispatch(args.workspaceId).effects.list(args);},
    'dispatch.effectDispositionReceipt':async args=>{return app.memberDispatch(args.workspaceId).effects.receipt(args);},
    'dispatch.effectRelations':async args=>{return app.memberDispatch(args.workspaceId).effects.relations(args);},
    'dispatch.effectDisposition':async args=>{
return app.memberDispatch(args.workspaceId).effects.record(args,{kind:'local_desktop',interaction:'explicit_submit'});},
    'dispatch.graphSnapshot':async args=>{return app.memberDispatch(args.identity?.workspaceId).snapshot(args.identity);},
    'dispatch.graphDelta':async args=>{return app.memberDispatch(args.identity?.workspaceId).delta(args.identity,args.cursor,args.limit);},
    'dispatch.sessionRead':async args=>{return app.memberDispatch(args.identity?.workspaceId).sessionRead(args);},
    'dispatch.scopeUsage':async args=>{return app.memberDispatch(args.workspaceId).usage.read(args);},
    'dispatch.requestBudget':async args=>{return app.requestBudgets(args.workspaceId).report(args);},
    'dispatch.executionStart':async args=>{return app.memberExecution(args.workspaceId).start(args);},
    'dispatch.executionStop':async args=>{return app.memberExecution(args.workspaceId).stop(args);},
    'dispatch.executionInspect':async args=>{return app.memberExecution(args.workspaceId).inspect(args);},
    'dispatch.executionReport':async args=>{return app.memberExecution(args.workspaceId).report(args);},
    'dispatch.artifactReport':async args=>{return app.memberExecution(args.workspaceId).artifactReport(args);},
    'dispatch.manifestReport':async args=>{return app.memberExecution(args.workspaceId).manifestReport(args);},
    'dispatch.replans.preview':async args=>{return app.memberDispatch(args.workspaceId).replans.preview(args);},
    'dispatch.humanPreview':async args=>{return app.memberDispatch(args.workspaceId).humanDecisions.preview(args);},
    'dispatch.humanReceipt':async args=>{return app.memberDispatch(args.workspaceId).humanDecisions.inspect(args);},
    'dispatch.humanHistory':async args=>{return app.memberDispatch(args.workspaceId).humanDecisions.history(args);},
    'dispatch.humanDecide':async args=>{
return app.memberDispatch(args.workspaceId).humanDecisions.decide(args,{kind:'local_desktop',interaction:'explicit_submit'});},
    'dispatch.executionEvents':async args=>{return app.memberExecution(args.workspaceId).events(args);},
    'dispatch.messages':async args=>{return app.memberExecution(args.workspaceId).messages(args);},
    'dispatch.acknowledge':async args=>{return app.memberExecution(args.workspaceId).acknowledge(args);},
    'dispatch.approvals':async args=>{return app.memberExecution(args.workspaceId).pendingApprovals(args);},
    'dispatch.approve':async args=>{const {approvalId,allow,allowAll,...identity}=args;return app.memberExecution(identity.workspaceId).answerApproval(identity,approvalId,allow,allowAll===true)},
    'dispatch.questions':async args=>{return app.memberExecution(args.workspaceId).pendingQuestions(args);},
    'dispatch.answerQuestion':async args=>{const {questionId,answers,...identity}=args;return app.memberExecution(identity.workspaceId).answerQuestion(identity,questionId,answers)},
  };
}
