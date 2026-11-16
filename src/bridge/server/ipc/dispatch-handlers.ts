/**
 * 作用定位：成员派发、运行核实与人工处置的主进程处理器。
 * 设计原因：scope 与原命令身份由请求明确选择，写入来源仅由桌面闭包注入，服务继续裁决权限与并发。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import type { DispatchIpcResponses } from '../../contracts/ipc-dispatch';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function dispatchIpcHandlers(app: ApplicationServices): IpcHandlers<keyof DispatchIpcResponses>
{
  return {
    'dispatch.isolatedExecutionReport': async args => { return app.IsolatedExecutions(args.workspaceId).Report(args); },

    'dispatch.isolatedExecutionCleanup': async args => { return app.IsolatedExecutions(args.workspaceId).Cleanup(args); },

    'dispatch.controlledFileReport': async args => { return app.ControlledFiles(args.workspaceId).Report(args); },

    'dispatch.fileCompensationPreview': async args => { return app.ControlledFiles(args.workspaceId).Preview(args); },

    'dispatch.fileCompensate': async args => { return app.ControlledFiles(args.workspaceId).Compensate(args); },

    'dispatch.fileCompensationReceipt': async args => { return app.ControlledFiles(args.workspaceId).Receipt(args); },

    'dispatch.open': async args => { return app.MemberDispatch(args.workspaceId).OpenGraph(args); },

    'dispatch.memberCreate': async args => { return app.MemberDispatch(args.workspaceId).CreateMember(args); },

    'dispatch.task': async args => { const { scopeId, ...request } = args; return app.MemberDispatch(args.workspaceId).DispatchTask(request, scopeId) },

    'dispatch.ownerInspect': async args => { return app.MemberDispatch(args.workspaceId).OwnerInspect(args); },

    'dispatch.commandReport': async args => { return app.MemberDispatch(args.workspaceId).CommandReport(args); },

    'dispatch.effectObserve': async args => { return app.MemberDispatch(args.workspaceId).effects.Observe(args); },

    'dispatch.effectDispositionList': async args => { return app.MemberDispatch(args.workspaceId).effects.List(args); },

    'dispatch.effectDispositionReceipt': async args => { return app.MemberDispatch(args.workspaceId).effects.Receipt(args); },

    'dispatch.effectRelations': async args => { return app.MemberDispatch(args.workspaceId).effects.Relations(args); },

    'dispatch.effectDisposition': async args => { return app.MemberDispatch(args.workspaceId).effects.Record(args, { kind: 'local_desktop', interaction: 'explicit_submit' }); },

    'dispatch.graphSnapshot': async args => { return app.MemberDispatch(args.identity?.workspaceId).Snapshot(args.identity); },

    'dispatch.graphDelta': async args => { return app.MemberDispatch(args.identity?.workspaceId).Delta(args.identity, args.cursor, args.limit); },

    'dispatch.sessionRead': async args => { return app.MemberDispatch(args.identity?.workspaceId).SessionRead(args); },

    'dispatch.scopeUsage': async args => { return app.MemberDispatch(args.workspaceId).usage.Read(args); },

    'dispatch.requestBudget': async args => { return app.RequestBudgets(args.workspaceId).Report(args); },

    'dispatch.executionStart': async args => { return app.MemberExecution(args.workspaceId).Start(args); },

    'dispatch.executionStop': async args => { return app.MemberExecution(args.workspaceId).Stop(args); },

    'dispatch.executionInspect': async args => { return app.MemberExecution(args.workspaceId).Inspect(args); },

    'dispatch.executionReport': async args => { return app.MemberExecution(args.workspaceId).Report(args); },

    'dispatch.artifactReport': async args => { return app.MemberExecution(args.workspaceId).ArtifactReport(args); },

    'dispatch.manifestReport': async args => { return app.MemberExecution(args.workspaceId).ManifestReport(args); },

    'dispatch.replans.preview': async args => { return app.MemberDispatch(args.workspaceId).replans.Preview(args); },

    'dispatch.humanPreview': async args => { return app.MemberDispatch(args.workspaceId).humanDecisions.Preview(args); },

    'dispatch.humanReceipt': async args => { return app.MemberDispatch(args.workspaceId).humanDecisions.Inspect(args); },

    'dispatch.humanHistory': async args => { return app.MemberDispatch(args.workspaceId).humanDecisions.History(args); },

    'dispatch.humanDecide': async args => { return app.MemberDispatch(args.workspaceId).humanDecisions.Decide(args, { kind: 'local_desktop', interaction: 'explicit_submit' }); },

    'dispatch.executionEvents': async args => { return app.MemberExecution(args.workspaceId).Events(args); },

    'dispatch.messages': async args => { return app.MemberExecution(args.workspaceId).Messages(args); },

    'dispatch.acknowledge': async args => { return app.MemberExecution(args.workspaceId).Acknowledge(args); },

    'dispatch.approvals': async args => { return app.MemberExecution(args.workspaceId).PendingApprovals(args); },

    'dispatch.approve': async args => { const { approvalId, allow, allowAll, ...identity } = args; return app.MemberExecution(identity.workspaceId).AnswerApproval(identity, approvalId, allow, allowAll === true) },

    'dispatch.questions': async args => { return app.MemberExecution(args.workspaceId).PendingQuestions(args); },

    'dispatch.answerQuestion': async args => { const { questionId, answers, ...identity } = args; return app.MemberExecution(identity.workspaceId).AnswerQuestion(identity, questionId, answers) },
  };
}
