import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Application} from '../src/bridge/server/application';
import {moduleGovernanceReceiptSchema,moduleGovernanceListSchema} from '../src/logic/governance/rules/module-governance';
import {seedModuleGovernance} from './module-governance-fixture';
import {request} from './data/knowledge';
import {moduleGovernanceToolsFixture as data} from './module-governance-tools-provider';
export {workflowConditionRecords as moduleGovernanceToolsRecords,workflowConditionLogBytes as moduleGovernanceToolsLogBytes} from './workflow-condition-fixture';

/** Real static module and explicit desktop protection; the provider never creates its own trusted identity or ledger. */
export async function seedModuleGovernanceTools(app:Application,project:string,provider:{url:string}){
  const models=await app.models.save({profile:{name:'Module governance tools fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Module governance tools fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const profile=models.profiles.find(item=>item.name==='Module governance tools fixture');if(!profile)throw Error('Actual governance model profile missing');
  const seeded=await seedModuleGovernance(app,project),workspace=app.workspace(seeded.entry.id),definition={...seeded.definition,maintenance:{bindingId:'governance-tools-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'governance-tools-confirmation',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}}};
  await workspace.commit(request(await workspace.snapshot(),[{path:data.moduleId+'/module.json',text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const snapshot=await workspace.snapshot(),identity={workspaceId:seeded.entry.id,instanceId:workspace.instanceId},registered=moduleGovernanceReceiptSchema.parse(await app.dispatch('governance.register',{...identity,commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:snapshot.revision}));
  if(registered.action!=='register')throw Error('真实桌面保护登记回执缺失');
  const proposed=seeded.original.replace('管理资源。','管理资源。\n\n'+data.marker+'\n\n知识维护与业务实现分别核实，所有变更保持既有模块身份与责任边界。');
  return {...seeded,identity,snapshot,definition,proposed,protection:registered.record,profileId:profile.id};
}

/** Read all original journal bytes; private proposal writes must not masquerade as formal knowledge commits. */
export async function moduleGovernanceToolsJournalBytes(user:string,workspaceId:string){
  const directory=path.join(user,workspaceId,'transactions'),names=(await fs.readdir(directory)).sort(),entries=await Promise.all(names.map(async name=>[name,(await fs.readFile(path.join(directory,name))).toString('base64')] as const));
  return Object.fromEntries(entries);
}
export async function moduleGovernanceToolsHistory(app:Application,workspaceId:string,proposalId?:string){return moduleGovernanceListSchema.parse(await app.dispatch('governance.list',{workspaceId,instanceId:app.workspace(workspaceId).instanceId,moduleId:data.moduleId,...(proposalId?{proposalId}:{})}));}
