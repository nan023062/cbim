import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {scopeBudgetFixture as data,type BudgetFixtureMode} from './scope-budget-provider';

export {usageScopes as budgetScopes} from './scope-usage-fixture';
export function budgetLimits(mode:BudgetFixtureMode){return mode==='unknown-price'||mode==='cost-limit'?{estimatedCostUsd:mode==='cost-limit'?0.00042:1}:{tokens:mode==='main-limit'?360:mode==='member-limit'?1560:1920}}
export const budgetDenies=(mode:BudgetFixtureMode)=>['main-limit','member-limit','cost-limit','unknown-price'].includes(mode);
export const budgetUnpriced=(mode:BudgetFixtureMode)=>mode==='unknown-price'||mode==='tokens-unpriced';

/** Isolated maintained module and actual profile, with absent prices only for the explicit unknown-price cases. */
export async function seedScopeBudget(app:Application,project:string,provider:{url:string;bind:(agentId:string,moduleId:string,selection?:OwnerExecutionSelection)=>void},mode:BudgetFixtureMode){
  await app.models.save({profile:{name:'Scope budget fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Scope budget fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,...(!budgetUnpriced(mode)?{pricing:{input:1,output:2,cacheRead:0,cacheWrite:0}}:{})}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'budget-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'budget-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const profileId=(await app.models.list()).selectedId!;
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:data.model});
  provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await fs.writeFile(path.join(project,data.file),data.fact);return {entry,team,profileId};
}
