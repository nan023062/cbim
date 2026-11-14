/**
 * 粘贴导入在应用退出期间拒绝，已保存的附件不会自动发送。
 * 网页设置管理浏览器 robots 策略、Brave 开关和加密密钥摘要，不向页面提供任意抓取代理。
 * 作用定位：主进程 IPC 的运行时请求解析与受理前拒绝；源浏览在退出期间停止接单且畸形参数返回可读提示，保留旧队列插入的失效运行错误码。
 * 设计原因：统一 Schema 后仍保留关闭门禁和领域错误码，避免客户端把已拒绝请求误当成待核实事务。
 * 职责边界：只转换解析失败；绝不捕获服务调用后的异常，也不声称写入失败等于未受理。
 */
import {ZodError} from 'zod';
import {parseIpcRequest,type ApplicationIpcAction} from '../../contracts/ipc-call';
import {fail} from '../../../core/errors';
const shutdownMessages:Partial<Record<ApplicationIpcAction,string>>={
  'source.list':'CBIM 正在退出，无法读取源目录',
  'source.read':'CBIM 正在退出，无法读取源文件',
  'chat.paths':'CBIM 正在退出，未导入路径',
  'chat.image':'CBIM 正在退出，未导入图片',
  'agent.configureMain':'CBIM 正在退出',
  'dispatch.effectDisposition':'CBIM 正在退出，未保存新处置',
  'dispatch.humanDecide':'CBIM 正在退出，未保存新的人工决定',
  'governance.register':'CBIM 正在退出，未登记保护',
  'governance.observe':'CBIM 正在退出，未保存观察',
  'governance.propose':'CBIM 正在退出，未保存提案',
  'governance.decide':'CBIM 正在退出，未保存决定',
  'governance.apply':'CBIM 正在退出，未保存实施意图',
  'resources.connection.grant':'CBIM 正在退出，未保存新授权',
  'resources.connection.revoke':'CBIM 正在退出，请重开后核实授权',
  'admission.configure':'CBIM 正在退出',
  'budget.configure':'CBIM 正在退出',
  'web.configure':'CBIM 正在退出',
  'github.feedback.begin':'CBIM 正在退出',
  'add':'CBIM 正在退出',
};
const inputCodes:Partial<Record<ApplicationIpcAction,string>>={
  'dispatch.fileCompensate':'FILE_COMPENSATION_PRE_ACCEPT_INPUT',
  'dispatch.commandReport':'COMMAND_REPORT_INPUT',
  'dispatch.artifactReport':'ARTIFACT_INPUT_INVALID',
  'dispatch.manifestReport':'MANIFEST_INPUT_INVALID',
  'dispatch.executionReport':'MEMBER_INPUT_INVALID',
  'dispatch.replans.preview':'REPLAN_INPUT_INVALID',
  'dispatch.effectDisposition':'EFFECT_PREACCEPT_INPUT_INVALID',
  'loop.goalContinue':'GOAL_CONTINUATION_INPUT','loop.goalContinuation':'GOAL_CONTINUATION_INPUT',
  'loop.topicInterrupt':'TOPIC_INPUT_INVALID',
  'loop.humanContinue':'HUMAN_CONTINUATION_INPUT','loop.humanContinuation':'HUMAN_CONTINUATION_INPUT',
  'loop.recoveryStart':'RECOVERY_INPUT_INVALID','loop.recoveryReceipt':'RECOVERY_INPUT_INVALID',
  'loop.replanStart':'REPLAN_INPUT_INVALID','loop.replanReceipt':'REPLAN_INPUT_INVALID',
  'github.feedback.begin':'GITHUB_CONFIG','github.feedback.poll':'GITHUB_FLOW',
  'task':'TOOL','local':'TYPE',
};
/** 服务仍核实身份、权限、CAS 和幂等；这里的错误仅证明还没有进入服务。 */
export function parseApplicationRequest<A extends ApplicationIpcAction>(action:A,input:unknown,stopping:boolean){
  const shutdown=shutdownMessages[action];if(stopping&&shutdown)fail('SHUTTING_DOWN',shutdown);
  try{return parseIpcRequest(action,input)}catch(error){
    if(!(error instanceof ZodError))throw error;
    if(action==='source.list'||action==='source.read')fail('SOURCE_INPUT','源浏览请求缺少有效身份或路径，请刷新架构后重试');
    // 缺少原运行身份不能由路由补齐；提前拒绝仍保留队列“不发送、原消息保留”的公开错误语义。
    if(action==='loop.queueInsert'&&error.issues.every(issue=>issue.path.length===1&&issue.path[0]==='expectedRunId'))fail('QUEUE_INSERT_STALE','缺少有效的原主运行标识，原消息仍保留在队列');
    const code=inputCodes[action]
      ??(action.startsWith('workspace.members.')?'MEMBER_INPUT_INVALID':undefined)
      ??(action.startsWith('workspace.ownerships.')?'OWNERSHIP_INPUT':undefined)
      ??(action.startsWith('governance.')?'GOVERNANCE_INPUT':undefined)
      ??(action.startsWith('resources.connection.')?'REPOSITORY_CONNECTION_INPUT':undefined)
      ??(['chat.materialTargets','chat.materialList','chat.import','chat.importCancel'].includes(action)?'ATTACHMENT_IMPORT_INPUT':undefined)
      ??(action.startsWith('dispatch.human')?'HUMAN_INPUT_INVALID':undefined)
      ??(action.startsWith('dispatch.effect')?'EFFECT_INPUT_INVALID':undefined)
      ??(['dispatch.executionStart','dispatch.executionStop','dispatch.executionInspect','dispatch.executionEvents','dispatch.messages','dispatch.acknowledge','dispatch.approvals','dispatch.approve','dispatch.questions','dispatch.answerQuestion'].includes(action)?'MEMBER_INPUT_INVALID':undefined)
      ??(['dispatch.open','dispatch.memberCreate','dispatch.task','dispatch.graphSnapshot','dispatch.graphDelta','dispatch.sessionRead'].includes(action)?'GRAPH_INPUT_INVALID':undefined);
    if(code)fail(code,error.issues.map(issue=>issue.message).join('；'));
    throw error;
  }
}
