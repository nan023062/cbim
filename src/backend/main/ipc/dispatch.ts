/**
 * 隔离资源核实只读；清理接受原运行/执行/报告版本和当前实例，无法通过IPC指定路径或PID。
 * 受控补偿边界：四项桌面入口只查原操作、预览和显式提交新补偿；模型无补偿入口，原 unknown 和原日志不改写。
 * 请求预算仅路由完整身份的只读摘要；设置改变只影响新目标，IPC 没有清除预留或签发发送许可的入口。
 * 作用定位：将经过主进程接入的 action 路由到明确的工作区和应用服务。
 * GitHub 边界：仅暴露登录、轮询和断开，不提供绕过运行权限的 Issue 写入 IPC，不返回任何凭据。
 * 设计原因：通过 ApplicationServices 隔离实现；人工保存不启动模型，humanContinue 只消费已保存决定。资料导入/取消独立于等待受理，IPC 不接收来源 proof 或仓库凭据。
 * 资源连接：桌面显式登记、授权与核验分别路由；只读原回执和未受理证明不重放知识提交，不接受客户端地址或令牌。
 * 模块治理：登记、观察、决定与独立实施按原命令路由；只有可信桌面闭包提供人工来源，普通 commit 没有批准参数。
 * 队列插入：原样传递用户操作时的 expectedRunId，由执行管理器统一拒绝缺省、过期或停止请求，不替客户端猜当前运行。
 * 岗位执行：显式派发必须传当前 scopeId，由服务核计划、责任和岗位；旧 loop.start 在解析模型前拒绝新业务执行，历史读取不变。
 * 模块责任：六个桌面入口复用同一责任服务，人工 actor 由本闭包注入；查询原回执不重新提交或改派执行成员。
 * 原命令报告：客户端只选择 workspace/root/run/call；已有服务核原 canonical 与 Store，不隐式打开工作区或补充提交证明。
 * 影响处置：五个桌面入口共用只读观察和不可变附录；只有明确保存注入本机 actor，当前文件事实不清除原 unknown。
 */
import {parseApplicationRequest} from './request';
import type {ApplicationServices} from './services';
import {fail} from '../../core/foundation/errors';
import {isIpcAction,type IpcHandlers,type ApplicationIpcAction,type IpcAction,type IpcResponse} from '../../../bridge/contracts/ipc-call';
import {desktopIpcRequests} from '../../../bridge/contracts/ipc-desktop';
import {agentHistoryIpcHandlers} from './agent-history';
import {peopleIpcHandlers} from './people-handlers';
import {governanceIpcHandlers} from './governance-handlers';
import {dispatchIpcHandlers} from './dispatch-handlers';
import {settingsIpcHandlers} from './settings-handlers';
import {loopIpcHandlers} from './loop-handlers';
import {chatIpcHandlers} from './chat-handlers';
import {resourcesIpcHandlers} from './resources-handlers';
import {workspaceIpcHandlers} from './workspace-handlers';

function handlers(app:ApplicationServices):IpcHandlers<ApplicationIpcAction>{return {
 ...peopleIpcHandlers(app),...governanceIpcHandlers(app),...dispatchIpcHandlers(app),...settingsIpcHandlers(app),...loopIpcHandlers(app),...chatIpcHandlers(app),...resourcesIpcHandlers(app),...workspaceIpcHandlers(app),
 ...agentHistoryIpcHandlers(app),
}}
function isApplicationAction(action:string):action is ApplicationIpcAction{return isIpcAction(action)&&!Object.hasOwn(desktopIpcRequests,action)}
async function invoke<A extends ApplicationIpcAction>(app:ApplicationServices,action:A,input:unknown):Promise<IpcResponse<A>>{
 const request=parseApplicationRequest(action,input,app.isStopping);return handlers(app)[action](request);
}
/** 原始传输入口只接受 unknown；按已登记操作解析，业务校验和权限仍在服务内。 */
export function dispatchApplication<A extends IpcAction>(app:ApplicationServices,action:A,input?:unknown):Promise<IpcResponse<A>>;
export function dispatchApplication(app:ApplicationServices,action:string,input?:unknown):Promise<unknown>;
export async function dispatchApplication(app:ApplicationServices,action:string,input:unknown={}){
 if(!isApplicationAction(action))fail('ACTION','未知操作');
 if(action==='loop.start')fail('OWNER_DISPATCH_REQUIRED','业务执行必须通过当前目标计划和负责岗位派发；旧任务历史仍可读取');
 return invoke(app,action,input);
}
