import {randomUUID} from 'node:crypto';
import type {Application} from '../src/backend/main/application';
import {moduleGovernanceReceiptSchema,moduleGovernanceListSchema} from '../src/backend/core/governance/module-governance';
import {seedModuleGovernance} from './module-governance-fixture';
import {governanceFeedbackFixture as data} from './module-governance-feedback-provider';
export {moduleGovernanceToolsRecords as governanceFeedbackRecords,moduleGovernanceToolsLogBytes as governanceFeedbackLogBytes,moduleGovernanceToolsJournalBytes as governanceFeedbackJournalBytes} from './module-governance-tools-fixture';

/** Only the explicit desktop protection is seeded; original and revised proposals must both be created by actual main Pi runs. */
export async function seedGovernanceFeedback(app:Application,project:string,provider:{url:string}){
  await app.models.save({profile:{name:'Governance feedback fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Governance feedback fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const seeded=await seedModuleGovernance(app,project),receipt=moduleGovernanceReceiptSchema.parse(await app.dispatch('governance.register',{...seeded.identity,commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:seeded.snapshot.revision}));if(receipt.action!=='register')throw Error('真实保护登记缺少回执');return {...seeded,protection:receipt.record};
}
export async function governanceFeedbackHistory(app:Application,workspaceId:string,proposalId?:string){return moduleGovernanceListSchema.parse(await app.dispatch('governance.list',{workspaceId,instanceId:app.workspace(workspaceId).instanceId,moduleId:data.moduleId,...(proposalId?{proposalId}:{})}));}
