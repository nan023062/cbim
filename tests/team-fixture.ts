import {knowledgeTools} from '../src/logic/tools/runtime/knowledge-tools';
import type {Workspace} from '../src/backend/main/workspace/workspace';
import {summary,moduleFiles} from './data/knowledge';
export async function seedTeam(w:Workspace){
  const service=knowledgeTools(w),identity={workspaceId:w.entry.id,instanceId:w.instanceId};
  const call=async(name:string,args:any={},write=false)=>JSON.parse((await service.callFromRun(name,{...identity,...args},write)).content[0].text);
  const mutate=async(operations:any[])=>{const snap=await w.snapshot();const preview=await call('cbim_object_preview',{revision:snap.revision,operations});await call('cbim_object_commit',{planId:preview.planId},true);return preview.objects as string[]};
  const [agentId,moduleId]=await mutate([{kind:'agent',action:'create',parentId:'.cbim/team',slug:'dev',data:{name:'开发者',summary,capabilities:['实现']},body:'# 原则\n验证实际结果。'},{kind:'module',action:'create',parentId:'.cbim/workspace',slug:'game',data:{summary},body:moduleFiles('game')[1].text}]);
  const [shared,own,workflowId,child]=await mutate([{kind:'skill',action:'create',parentId:'.cbim/team',slug:'review',data:{name:'review',purpose:'验证'},body:'# 团队校验规则'},{kind:'skill',action:'create',parentId:agentId,slug:'coding',data:{name:'coding',purpose:'实现'},body:'# 专业实现规则'},{kind:'workflow',action:'create',parentId:moduleId,slug:'build',data:{name:'构建验证'},body:'# 工作流\n先理解目标，再验证并记录证据。'},{kind:'module',action:'create',parentId:moduleId,slug:'child',data:{summary},body:moduleFiles('game/child')[1].text}]);
  return {input:{goal:'核实工作区并提交证据',agentId,moduleId,workflowId,acceptance:['返回真实工作区身份']},shared,own,child,call};
}
