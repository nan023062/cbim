import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';

/** 适配已有知识端口与逐调用权限；不创建 Application，不启动外部传输或改变工作区授权。 */
export function internalKnowledge(workspace:KnowledgeWorkspace){
  const service=knowledgeTools(workspace),identity={workspaceId:workspace.entry.id,instanceId:workspace.instanceId};
  const call=async(name:string,args:Record<string,unknown>={},write=false)=>JSON.parse((await service.callFromRun(name,{...identity,...args},write)).content[0].text);
  return {service,identity,call};
}
