/**
 * 排队入口传递原始文本；材料冻结由会话服务负责，避免重复展开或由客户端提供清单。
 * 作用定位：会话、排队、历史与安全续接的主进程处理器。
 * 设计原因：插入绑定原 expectedRunId，查询原回执不重放；退役的业务启动入口继续拒绝。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import { loopChoicesSchema, type LoopIpcResponses } from '../../contracts/ipc-loop';

import { ChatInputs } from '../../../logic/materials/service/chat-inputs';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function loopIpcHandlers(app: ApplicationServices): IpcHandlers<keyof LoopIpcResponses>
{
  return {
    'loop.prepare': async args => { return app.Execution(args.id).Prepare(args.task); },
    'loop.choices': async args => { return loopChoicesSchema.parse(await app.Execution(args.id).Choices()); },
    'loop.thread': async args => { return app.Execution(args.id).Thread(args.taskId); },
    'loop.threadView': async args => { return app.Execution(args.id).ThreadView(args.taskId); },
    'loop.start': async args => { throw new Error('业务执行必须通过当前目标计划和负责岗位派发；旧任务历史仍可读取'); },
    'loop.queue': async args => { return app.Execution(args.id).Queued(args.taskId); },
    'loop.queueDelta': async args => { return app.Execution(args.id).QueueDelta(args.taskId, args.cursor); },
    'loop.enqueue': async args => { return app.Execution(args.id).Enqueue(args.taskId, args.message, await app.ChatOptions(args.id, args.options, args.attachments), args.followupOf); },
    'loop.queueChange': async args => { return app.Execution(args.id).ChangeQueued(args.taskId, args.queueId, args.action); },
    'loop.queueEdit': async args => { return app.Execution(args.id).EditQueued(args.taskId, args.queueId, args.message, args.expected); },
    'loop.queueMove': async args => { return app.Execution(args.id).MoveQueued(args.taskId, args.queueId, args.beforeId); },
    'loop.queueInsert': async args => { return app.Execution(args.id).InsertQueued(args.taskId, args.queueId, args.expectedRunId); },
    'loop.queueContinue': async args => { return app.Execution(args.id).ContinueQueue(args.taskId); },
    'loop.chat': async args => { return app.Execution(args.id).Chat(await new ChatInputs(app.Workspace(args.id)).Message(args.message, args.attachments), await app.ChatOptions(args.id, args.options, args.attachments)); },
    'loop.resume': async args => { return app.Execution(args.id).Resume(args.taskId, args.runId, await new ChatInputs(app.Workspace(args.id)).Message(args.message, args.attachments), await app.ChatOptions(args.id, args.options, args.attachments), args.reconciledToolIds); },
    'loop.goalContinue': async args => { return app.Execution(args.workspaceId).ContinueGoal(args); },
    'loop.topicInterrupt': async args => { return app.Execution(args.workspaceId).InterruptTopic(args); },
    'loop.goalContinuation': async args => { return app.MemberDispatch(args.workspaceId).continuations.Inspect(args); },
    'loop.humanContinue': async args => { return app.Execution(args.workspaceId).ContinueFromHumanDecisions(args); },
    'loop.humanContinuation': async args => { return app.MemberDispatch(args.workspaceId).humanContinuations.Inspect(args); },
    'loop.recoveryStart': async args => { return app.Execution(args.workspaceId).RecoverExecution(args); },
    'loop.recoveryReceipt': async args => { return app.MemberDispatch(args.workspaceId).recoveries.Inspect(args); },
    'loop.replanStart': async args => { return app.Execution(args.workspaceId).ReplanExecution(args); },
    'loop.replanReceipt': async args => { return app.MemberDispatch(args.workspaceId).replans.Inspect(args); },
    'loop.questions': async args => { return app.Execution(args.id).PendingQuestions(args.taskId); },
    'loop.answerQuestion': async args => { return app.Execution(args.id).AnswerQuestion(args.taskId, args.questionId, args.answers); },
    'loop.approvals': async args => { return app.Execution(args.id).PendingApprovals(args.taskId); },
    'loop.approve': async args => { return app.Execution(args.id).AnswerApproval(args.taskId, args.approvalId, args.allow, args.allowAll === true); },
    'loop.setPermission': async args => app.Execution(args.id).SetOfficePermission(args.taskId, args.runId, args.permission),
    'loop.stop': async args => { return app.Execution(args.id).Stop(args.taskId); },
    'loop.inspect': async args => { const run = await app.Execution(args.id).Inspect(args.taskId, args.runId);
      if (args.afterSeq === undefined) return run;
      if (args.afterSeq > (run.events.at(-1)?.seq ?? 0)) throw new Error('事件游标超过当前运行日志');
      return { ...run, events: run.events.filter(event => event.seq > args.afterSeq!) }; },
    'loop.list': async args => { return app.Execution(args.id).List(); },
  };
}
