/**
 * 作用定位：解析自动模式的隐式全项目范围，复用真实模块既有的维护与 Workflow 规则。
 * 设计原因：空项目可以执行，却不应偷偷写入 .cbim 模块或伪造维护确认；保底身份始终单独留痕。
 * 职责边界：只读固定知识，不能扩大权限、忽略无效知识或为已有模块创建全项目捷径。
 */
import {fail} from '../../core/foundation/errors';
import {implicitProjectModuleId,type AutomaticExecutionBinding} from '../../core/team/automatic-execution';
import type {Snapshot} from '../../core/knowledge/types';
import type {ModuleBinding} from '../../core/tasks/graph-types';
import type {WorkflowSelection} from '../../core/tasks/workflow-selection';
import {resolveDispatchModules} from './dispatch-context';

/** 只有真实模块清单为空且有已核实兜底身份时，才解析预留的全项目模块。 */
export async function resolveExecutionModules(snapshot:Snapshot,ids:string[],selections?:readonly WorkflowSelection[],fallback?:AutomaticExecutionBinding):Promise<ModuleBinding[]>{
  if(fallback?.reason!=='no_modules')return resolveDispatchModules(snapshot,ids,selections);
  if(!snapshot.validation?.structural||Object.keys(snapshot.validation.tree.nodes).length||ids.length!==1||ids[0]!==implicitProjectModuleId||selections?.length)fail('AUTO_MODULES_CHANGED','仅无业务模块的完整项目可以采用隐式全项目范围，请重新读取并规划');
  return [{moduleId:implicitProjectModuleId,name:'全项目（自动模式隐式模块）',knowledgeRevision:snapshot.revision,maintenanceBindingId:'cbim:implicit-project',maintainerPersonIds:[],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'项目尚未定义业务模块，自动模式以全项目为临时范围；未登记正式模块或维护人'}}];
}
