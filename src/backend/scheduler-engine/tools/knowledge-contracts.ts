/**
 * 作用定位：将实际知识工具与 Core 业务输出 Schema、取消及恢复说明绑定，供工具注册使用。
 * 设计原因：元数据按现有事务行为逐项声明；v2 刷新保留原请求身份，不能用工具名猜授权或把协议失败视为未提交及通用可重试。
 */
import type {z} from 'zod';
import {fail} from '../../../core/errors';
import {builtinSkills} from '../../../logic/knowledge/rules/builtins';
import {workspaceIdentityOutputSchema,knowledgeSnapshotOutputSchema,knowledgeSearchOutputSchema} from '../../../logic/knowledge/rules/tool-output-base';
import {moduleRegistryOutputSchema,moduleGetOutputSchema,agentRegistryOutputSchema,agentGetOutputSchema} from '../../../logic/knowledge/rules/tool-output-queries';
import {builtinCatalogOutputSchema,builtinReadOutputSchema} from '../../../logic/knowledge/rules/tool-output-builtins';
import {knowledgeRefreshOutputSchema,knowledgePreviewOutputSchema,knowledgeCommitOutputSchema,objectPreviewOutputSchema,objectCommitOutputSchema,maintenanceTaskOutputSchema,maintenanceTaskStatusOutputSchema} from '../../../logic/knowledge/rules/tool-output-transactions';
import {knowledgeToolCatalogOutputSchema,knowledgeToolDescribeOutputSchema,type ToolCancellation,type ToolRecovery} from '../../../logic/tools/rules/contracts';

const cancellation:ToolCancellation={mode:'preflight_only',description:'调用开始前检查取消；领域读取或事务开始后不承诺中断，取消不表示已有操作回滚。'};
const read:ToolRecovery={mode:'read_again',description:'可显式重新读取；知识、实例或维护状态可能已变化，不能把新读取伪装成旧版本回执。'};
const outputs:Record<string,z.ZodTypeAny>={
  cbim_workspace_identity:workspaceIdentityOutputSchema,cbim_knowledge_snapshot:knowledgeSnapshotOutputSchema,cbim_knowledge_search:knowledgeSearchOutputSchema,
  cbim_builtin_catalog:builtinCatalogOutputSchema,cbim_builtin_read:builtinReadOutputSchema,
  cbim_module_registry:moduleRegistryOutputSchema,cbim_module_get:moduleGetOutputSchema,cbim_agent_registry:agentRegistryOutputSchema,cbim_agent_get:agentGetOutputSchema,
  cbim_knowledge_refresh:knowledgeRefreshOutputSchema,cbim_object_preview:objectPreviewOutputSchema,cbim_object_commit:objectCommitOutputSchema,
  cbim_knowledge_preview:knowledgePreviewOutputSchema,cbim_knowledge_commit:knowledgeCommitOutputSchema,cbim_knowledge_move_preview:knowledgePreviewOutputSchema,
  cbim_rules_validate:maintenanceTaskOutputSchema,cbim_task_status:maintenanceTaskStatusOutputSchema,cbim_task_cancel:maintenanceTaskOutputSchema,
  cbim_knowledge_tool_catalog:knowledgeToolCatalogOutputSchema,cbim_knowledge_tool_describe:knowledgeToolDescribeOutputSchema,
};
for(const skill of builtinSkills)outputs['cbim_skill_'+skill.id.replaceAll('-','_')]=builtinReadOutputSchema;
const recovery:Record<string,ToolRecovery>={
  cbim_knowledge_preview:{mode:'new_preview',description:'只重新计算差异和校验，不保存提交计划；新预览仍核对原 revision，不表示原提交未发生。'},
  cbim_knowledge_move_preview:{mode:'new_preview',description:'每次移动预览可能创建新的 requestId；重新预览仍核对当前知识，不能用新请求替代未知提交结果。'},
  cbim_object_preview:{mode:'new_preview',description:'每次预览可能新建实例内计划。返回丢失时先核实；重新预览会产生另一 planId，旧计划不自动提交。'},
  cbim_knowledge_commit:{mode:'same_request',keyFields:['requestId'],description:'先核实是否已提交；仅原 requestId 与完全相同输入可按原事务协议取得回执，不能更换 ID 重放未知结果。'},
  cbim_object_commit:{mode:'same_plan',keyFields:['planId'],description:'先核实原计划提交；同实例原 planId 复用原知识事务，不接受新计划代替未知结果。目录清理警告可能变化，不承诺整个返回逐字相同。'},
  cbim_knowledge_refresh:{mode:'same_request',keyFields:['requestId'],description:'v2先核实原requestId及原revision对应的空变更事务；只有完全相同请求可复用原journal，不更换ID重放。当前校验可能变化；旧v1无原请求身份，保持未知。'},
  cbim_rules_validate:{mode:'query_task',queryTool:'cbim_task_status',description:'已取得维护 taskId 时查询状态；任务启动结果丢失时先核实实例内维护记录，不能盲目再创建任务。'},
  cbim_task_cancel:{mode:'query_task',keyFields:['taskId'],queryTool:'cbim_task_status',description:'这里只请求取消指定维护任务；返回后查询真实终态，不代表已停止或回滚，不接受对话或成员任务 ID。'},
};
/** 只为本实现真实注册的工具提供元数据；不存在的名称不以默认 Schema 冒充支持。 */
export function knowledgeToolContract(name:string){
  const outputSchema=Object.hasOwn(outputs,name)?outputs[name]:undefined;if(!outputSchema)fail('TOOL_CONTRACT','知识工具缺少业务输出契约');
  return {outputSchema,cancellation:structuredClone(cancellation),recovery:structuredClone(recovery[name]??read)};
}
