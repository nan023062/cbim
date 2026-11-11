/**
 * 作用定位：将自动化桌面请求路由到当前工作区唯一调度器。
 * 设计原因：每次调用先校验完整参数和工作区代际，再交由定义版本检查；没有任意执行路径、模型凭据或外部工作区参数。
 */
import type {AutomationAction} from '../../../bridge/contracts/automation';
import type {IpcHandlers,IpcRequest} from '../../../bridge/contracts/ipc-call';
import type {ApplicationServices} from './services';
/** 总入口已按共享 Schema 解析；每项仍核实当前实例，版本检查和调度归原服务。 */
export function automationIpcHandlers(app:Pick<ApplicationServices,'automations'>):IpcHandlers<AutomationAction>{
 // 完整动作已经严格解析；身份核实仅接收身份，不能把定义/版本字段混入严格身份 Schema。
 const service=({workspaceId,instanceId}:IpcRequest<'automation.list'>)=>{const current=app.automations(workspaceId);current.assert({workspaceId,instanceId});return current};
 return {
  'automation.list':value=>service(value).scheduler.list(),
  'automation.catalog':value=>service(value).catalog(),
  'automation.save':value=>service(value).scheduler.save(value.id,value.expectedRevision,value.definition),
  'automation.run':value=>service(value).scheduler.runNow(value.id,value.expectedRevision),
  'automation.toggle':value=>service(value).scheduler.change(value.id,value.expectedRevision,value.enabled?'resume':'pause'),
  'automation.remove':value=>service(value).scheduler.change(value.id,value.expectedRevision,'remove'),
 };
}
