import type {Application} from '../../../../../../src/bridge/server/application';
import {knowledgeContractFixture as data} from './knowledge-contract-provider';
export {workflowConditionRecords as knowledgeContractRecords,workflowConditionLogBytes as knowledgeContractLogBytes} from '../../../execution/assembly/support/workflow-condition-fixture';

/** Knowledge is created by the real bootstrap and changed only through the real approval/transaction service. */
export async function seedKnowledgeContract(app:Application,project:string,provider:{url:string}){
  await app.models.Save({profile:{name:'Knowledge contract fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Knowledge contract fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.Dispatch('add',{path:project}),snapshot=await app.Workspace(entry.id).Snapshot();return {entry,snapshot};
}
