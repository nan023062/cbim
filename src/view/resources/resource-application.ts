/**
 * 作用定位：资源列表的静态包识别与可创建种类策略，供列表和测试复用。
 * 设计原因：旧文本定义仍可浏览编辑，但不能把文本或单模块模板展示成可应用的完整知识包；正式校验由后端预览执行。
 */
import {resourceKinds,type ResourceCategory,type ResourceDefinition,type ResourceKind} from '../../bridge/contracts/resources';
export type ApplicableResourceKind='team'|'agent'|'skill'|'architecture';
/** 只判断展示入口是否适用；指纹、引用和业务规则仍须服务端验证，不能据此直接写入。 */
export function applicableResourceKind(item:Pick<ResourceDefinition,'kind'|'content'>):ApplicableResourceKind|undefined {
  if(!['team','agent','skill','architecture'].includes(item.kind))return;
  try{const value=JSON.parse(item.content);if(value?.format==='cbim-workspace-package'&&value.kind===item.kind)return item.kind as ApplicableResourceKind}catch{/* 旧 Markdown/JSON 文本不是可应用资源包。 */}
}
/** 已有 module/workflow 允许继续编辑，新增业务资源只使用完整 architecture。 */
export function creatableResourceKinds(category:ResourceCategory):ResourceKind[]{
  return (Object.keys(resourceKinds) as ResourceKind[]).filter(kind=>resourceKinds[kind].category===category&&kind!=='module'&&kind!=='workflow');
}
