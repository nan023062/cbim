import type {Application} from '../src/backend/main/application';
import type {Workspace} from '../src/backend/main/workspace/workspace';
import {registerFixtureOwner} from './owner-execution-fixture';

/** 服务测试显式采用真实岗位与唯一工作区账本；不修改 seedTeam，不启动模型或改变产品门禁。 */
export async function registerServiceOwner(app:Application,workspace:Workspace,agentId:string,moduleIds:string[],name='服务测试岗位'){
  const definition={name,api:'openai-completions' as const,baseUrl:'https://example.test/v1',auth:'none' as const,defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false,vision:false}]};
  const settings=await app.models.save({profile:definition}),profile=settings.profiles.find(item=>item.name===name)!;
  const registered=await registerFixtureOwner(app,workspace.entry.id,{agentId,moduleIds,profileId:profile.id,modelId:'fixture',name,adaptation:{instructions:'按已派发模块执行并保存真实证据。',references:[]}});
  return {registered,definition,model:await app.models.configuration(profile.id,'fixture')};
}
