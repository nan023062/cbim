/**
 * 作用定位：将自动化桌面请求路由到当前工作区唯一调度器。
 * 设计原因：每次调用先校验完整参数和工作区代际，再交由定义版本检查；没有任意执行路径、模型凭据或外部工作区参数。
 */
import {automationActionSchemas,type AutomationAction,type AutomationActionInput,type AutomationActionResults} from '../../../bridge/contracts/automation';
import type {ApplicationServices} from './services';
type Handlers={[K in AutomationAction]:(input:AutomationActionInput<K>)=>Promise<AutomationActionResults[K]>};
export function dispatchAutomationAction<K extends AutomationAction>(app:Pick<ApplicationServices,'automations'>,action:K,raw:unknown):Promise<AutomationActionResults[K]>{
 const input=automationActionSchemas[action].parse(raw) as AutomationActionInput<K>,service=app.automations(input.workspaceId);
 service.assert({workspaceId:input.workspaceId,instanceId:input.instanceId});
 const handlers:Handlers={
  'automation.list':()=>service.scheduler.list(),
  'automation.catalog':()=>service.catalog(),
  'automation.save':value=>service.scheduler.save(value.id,value.expectedRevision,value.definition),
  'automation.run':value=>service.scheduler.runNow(value.id,value.expectedRevision),
  'automation.toggle':value=>service.scheduler.change(value.id,value.expectedRevision,value.enabled?'resume':'pause'),
  'automation.remove':value=>service.scheduler.change(value.id,value.expectedRevision,'remove'),
 };
 return (handlers[action] as (input:AutomationActionInput<K>)=>Promise<AutomationActionResults[K]>)(input);
}
