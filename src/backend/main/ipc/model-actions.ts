/**
 * 作用定位：实现模型及主 Agent 配置的有类型桌面路由，委托已有配置服务处理状态与持久化。
 * 设计原因：请求校验及返回契约集中在公开协议，通用 dispatcher 不再枚举这一组业务字段。
 * 职责边界：不启动运行、不新增设置存储；主 Agent 保存继续检查退出状态、实例和版本。
 */
import {modelActionSchemas,type ModelAction,type ModelActionInput,type ModelActionResults} from '../../../bridge/contracts/model-actions';
import type {ApplicationServices} from './services';
import {fail} from '../../core/foundation/errors';

type Handlers={[K in ModelAction]:(input:ModelActionInput<K>)=>Promise<ModelActionResults[K]>};
/** 每个 handler 的参数和返回值均由公开 action 映射约束；实际业务核验仍在原服务内。 */
function handlers(app:Pick<ApplicationServices,'models'|'mainAgentSettings'|'isStopping'>):Handlers {
  return {
    'agent.mainSettings':input=>app.mainAgentSettings.read(input),
    'agent.configureMain':input=>{if(app.isStopping)fail('SHUTTING_DOWN','CBIM 正在退出');return app.mainAgentSettings.configure(input)},
    'models.list':()=>app.models.list(),
    'models.save':input=>app.models.save(input),
    'models.select':input=>app.models.select(input.id),
    'models.remove':input=>app.models.remove(input.id),
    'models.test':input=>app.models.test(input.id,input.modelId),
    'models.discover':input=>app.models.discover(input),
    'models.discoverDetails':input=>app.models.discoverDetails(input),
  };
}
/** 远端字节仍视为 unknown，先按精确 action 校验；不能用 TypeScript 类型替代运行时检查。 */
export function dispatchModelAction<K extends ModelAction>(app:Pick<ApplicationServices,'models'|'mainAgentSettings'|'isStopping'>,action:K,raw:unknown):Promise<ModelActionResults[K]> {
  const input=modelActionSchemas[action].parse(raw) as ModelActionInput<K>;
  const handle=handlers(app)[action] as (input:ModelActionInput<K>)=>Promise<ModelActionResults[K]>;
  return handle(input);
}
