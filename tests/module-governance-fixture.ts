import type {Application} from '../src/backend/main/assembly/application';
import {internalKnowledge} from './knowledge-tool-fixture';
import {moduleFiles,summary,request} from './data/knowledge';
export {repositoryConnectionRunFiles as moduleGovernanceRunFiles} from './repository-connection-fixture';

export const moduleGovernanceFixture={slug:'governed',moduleId:'.cbim/workspace/governed',unprotectedId:'.cbim/workspace/free',marker:'MODULE_GOVERNANCE_EXACT_APPROVED_18a_57d3',observation:'现有模块说明没有明确读取与写入职责，需要在不改变模块边界的前提下补充说明。',reason:'将已确认的模块职责和操作约束写入模块说明，保持定义及正文绑定不变。',alternative:'保留原说明，由人工临时解释；这会继续产生理解差异。',invariant:'模块身份、父子关系、源目录、维护人和 Workflow 均保持原样。',recovery:'如后续发现说明不准确，重新记录观察并提出新的精确正文方案，不直接回滚或修改受保护文件。',comment:'已核对原文、差异、理由和不变量；本次仅批准所示正文方案，不批准业务实现。',draft:'治理面板操作期间保留的普通主会话草稿。'};

/** Seed static modules through the actual object transaction. No model, member task, business code or protection is fabricated. */
export async function seedModuleGovernance(app:Application,project:string){
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),{call}=internalKnowledge(workspace),snapshot=await workspace.snapshot();
  const preview=await call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'module',action:'create',parentId:'.cbim/workspace',slug:moduleGovernanceFixture.slug,data:{summary},body:moduleFiles(moduleGovernanceFixture.slug)[1].text},{kind:'module',action:'create',parentId:'.cbim/workspace',slug:'free',data:{summary},body:moduleFiles('free')[1].text}]});
  if(!preview.validation.structural)throw Error('隔离治理模块准备未通过真实结构校验');await call('cbim_object_commit',{planId:preview.planId},true);
  const current=await workspace.snapshot(),definition=JSON.parse(current.files.find(file=>file.path===moduleGovernanceFixture.moduleId+'/module.json')!.text),overviewPath=moduleGovernanceFixture.moduleId+'/'+definition.overview,original=current.files.find(file=>file.path===overviewPath)!.text,proposed=original.replace('管理资源。','管理资源。\n\n'+moduleGovernanceFixture.marker+'\n\n只读资料与实际业务改动分别记录；修改应保持模块责任及依赖边界，并依据真实结果验证。');
  const candidate=await workspace.preview(request(current,[{path:overviewPath,text:proposed}]));if(!candidate.validation.structural)throw Error('隔离提案正文未通过真实校验：'+JSON.stringify(candidate.validation.issues));
  return {entry,identity:{workspaceId:entry.id,instanceId:workspace.instanceId},snapshot:current,definition,overviewPath,original,proposed,call};
}
