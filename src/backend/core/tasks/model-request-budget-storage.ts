/**
 * 作用定位：定义逐请求预算专用的读取和原子阶段提交端口，供预算服务与持久化适配器协作。
 * 设计原因：预算决策只需周期及预算账本，不应获得成员、任务图、邮箱或权限的整库读写能力。
 * 职责边界：实现仍须借用工作区唯一串行事务；不能另建账本、拆开预留判断和提交或释放未决消耗。
 */
import type {DispatchScope} from './dispatch-scope';
import type {ModelRequestBudgetChange} from './model-request-budget';

/** 旧存储缺省的预算附录按空历史读取，不补造任何请求结算。 */
export interface ModelRequestBudgetLedger {modelRequestBudgetChanges?:ModelRequestBudgetChange[]}
/** 事务内隔离副本；只公开预算决策所需的周期与请求阶段，不泄露整库状态。 */
export interface ModelRequestBudgetView extends ModelRequestBudgetLedger {scopes:DispatchScope[]}
export type ModelRequestBudgetReceipt=Pick<ModelRequestBudgetChange,'requestId'|'phase'|'revision'>;

/** 阶段提交只产生一条预算事实；原命令重放返回原回执，不再次执行 prepare。 */
export interface ModelRequestBudgetStore {
  read():Promise<ModelRequestBudgetView>;
  /** initial 固定幂等键和指纹；prepare 在原 Store 的同一串行屏障读取并决定 reserved/denied 或后续阶段。 */
  transact(initial:ModelRequestBudgetChange,prepare:(state:ModelRequestBudgetView)=>Promise<ModelRequestBudgetChange>):Promise<ModelRequestBudgetReceipt>;
}
