/**
 * 作用定位：会话、排队、历史与安全续接的主进程处理器。
 * 设计原因：插入绑定原 expectedRunId，查询原回执不重放；退役的业务启动入口继续拒绝。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import {loopChoicesSchema,type LoopIpcResponses} from '../../../bridge/contracts/ipc-loop';
import {ChatInputs} from '../materials/chat-inputs';
import {fail} from '../../core/foundation/errors';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function loopIpcHandlers(app:ApplicationServices):IpcHandlers<keyof LoopIpcResponses>{
  return {
    'loop.prepare':async args=>{return app.execution(args.id).prepare(args.task);},
    'loop.choices':async args=>{return loopChoicesSchema.parse(await app.execution(args.id).choices());},
    'loop.thread':async args=>{return app.execution(args.id).thread(args.taskId);},
    'loop.threadView':async args=>{return app.execution(args.id).threadView(args.taskId);},
    'loop.start':async args=>{fail('OWNER_DISPATCH_REQUIRED','业务执行必须通过当前目标计划和负责岗位派发；旧任务历史仍可读取');},
    'loop.queue':async args=>{return app.execution(args.id).queued(args.taskId);},
    'loop.queueDelta':async args=>{return app.execution(args.id).queueDelta(args.taskId,args.cursor);},
    'loop.enqueue':async args=>{return app.execution(args.id).enqueue(args.taskId,await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments));},
    'loop.queueChange':async args=>{return app.execution(args.id).changeQueued(args.taskId,args.queueId,args.action);},
    'loop.queueEdit':async args=>{return app.execution(args.id).editQueued(args.taskId,args.queueId,args.message,args.expected);},
    'loop.queueMove':async args=>{return app.execution(args.id).moveQueued(args.taskId,args.queueId,args.beforeId);},
    'loop.queueInsert':async args=>{return app.execution(args.id).insertQueued(args.taskId,args.queueId,args.expectedRunId);},
    'loop.queueContinue':async args=>{return app.execution(args.id).continueQueue(args.taskId);},
    'loop.chat':async args=>{return app.execution(args.id).chat(await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments));},
    'loop.resume':async args=>{return app.execution(args.id).resume(args.taskId,args.runId,await new ChatInputs(app.workspace(args.id)).message(args.message,args.attachments),await app.chatOptions(args.id,args.options,args.attachments),args.reconciledToolIds);},
    'loop.goalContinue':async args=>{return app.execution(args.workspaceId).continueGoal(args);},
    'loop.goalContinuation':async args=>{return app.memberDispatch(args.workspaceId).continuations.inspect(args);},
    'loop.humanContinue':async args=>{return app.execution(args.workspaceId).continueFromHumanDecisions(args);},
    'loop.humanContinuation':async args=>{return app.memberDispatch(args.workspaceId).humanContinuations.inspect(args);},
    'loop.recoveryStart':async args=>{return app.execution(args.workspaceId).recoverExecution(args);},
    'loop.recoveryReceipt':async args=>{return app.memberDispatch(args.workspaceId).recoveries.inspect(args);},
    'loop.replanStart':async args=>{return app.execution(args.workspaceId).replanExecution(args);},
    'loop.replanReceipt':async args=>{return app.memberDispatch(args.workspaceId).replans.inspect(args);},
    'loop.questions':async args=>{return app.execution(args.id).pendingQuestions(args.taskId);},
    'loop.answerQuestion':async args=>{return app.execution(args.id).answerQuestion(args.taskId,args.questionId,args.answers);},
    'loop.approvals':async args=>{return app.execution(args.id).pendingApprovals(args.taskId);},
    'loop.approve':async args=>{return app.execution(args.id).answerApproval(args.taskId,args.approvalId,args.allow,args.allowAll===true);},
    'loop.stop':async args=>{return app.execution(args.id).stop(args.taskId);},
    'loop.inspect':async args=>{return app.execution(args.id).inspect(args.taskId,args.runId);},
    'loop.list':async args=>{return app.execution(args.id).list();},
  };
}
