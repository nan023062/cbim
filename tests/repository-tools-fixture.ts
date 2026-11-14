import type {Application} from '../src/bridge/server/application';
import type {RepositoryConnectionPreview,RepositoryConnectionReceipt} from '../src/logic/connectors/rules/repository-connection';
import {randomUUID} from 'node:crypto';
import {seedRepositoryConnection} from './repository-connection-fixture';
import {repositoryToolsFixture as data} from './repository-tools-provider';
export {workflowConditionRecords as repositoryToolsRecords,workflowConditionLogBytes as repositoryToolsLogBytes} from './workflow-condition-fixture';

/** Register a genuine same-application repository definition and a separate grant; model configuration uses only the isolated SSE fixture. */
export async function seedRepositoryTools(app:Application,temp:string,provider:{url:string},authorized=true){
  await app.models.save({profile:{name:'Repository tools fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Repository tools fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const seeded=await seedRepositoryConnection(app,temp,false);await app.dispatch('resources.configure',{mode:'local',location:seeded.repository});const empty=await app.dispatch('resources.list');await app.dispatch('resources.save',{repositoryId:empty.repositoryId,revision:empty.revision,item:{kind:'skill',name:data.name,summary:data.summary,content:data.content}});const repository=await app.dispatch('resources.list');await app.dispatch('resources.share',{lan:false,port:0});
  const workspace=app.workspace(seeded.first.id),snapshot=await workspace.snapshot(),identity={workspaceId:seeded.first.id,instanceId:workspace.instanceId};
  const preview=await app.dispatch('resources.connection.preview',{...identity,revision:snapshot.revision,repositoryId:repository.repositoryId,connectorId:data.connectorId,name:'主调度只读资料源',summary:'只读外部资料，不是工作区文件证据'}) as RepositoryConnectionPreview;await app.dispatch('resources.connection.commit',{...identity,planId:preview.planId});
  const grant=authorized?await app.dispatch('resources.connection.grant',{...identity,connectorId:data.connectorId,repositoryId:repository.repositoryId,definitionHash:preview.definitionHash,expectedGrantRevision:0,commandId:randomUUID()}) as RepositoryConnectionReceipt:undefined;
  return {...seeded,entry:seeded.first,identity,library:repository,preview,grant};
}
