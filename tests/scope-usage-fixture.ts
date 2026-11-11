import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {scopeUsageReportSchema,type ScopeUsageReport} from '../src/backend/core/tasks/scope-usage';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {scopeUsageFixture as data} from './scope-usage-provider';

export async function seedScopeUsage(app:Application,project:string,provider:{url:string;bind:(agentId:string,moduleId:string,selection?:OwnerExecutionSelection)=>void}){
  await app.models.save({profile:{name:'Scope usage fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Scope usage fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:1,output:2,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'usage-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'usage-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const profileId=(await app.models.list()).selectedId!;
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:data.model});
  provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await fs.writeFile(path.join(project,data.file),data.fact);return {entry,team,profileId};
}

/** Read committed transactions without starting another writer or repairing live journals. */
export async function usageScopes(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};assert.equal(body.workspaceId,workspaceId);
    for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope);
  }
  return [...scopes.values()];
}

/** Exact expectations are computed from the explicitly reported deterministic provider usage, not UI formatting. */
export function assertScopeUsage(raw:unknown,which:'first'|'second'){
  const report=scopeUsageReportSchema.parse(raw),first=which==='first';
  assert.equal(report.coverage,'tracked');assert.equal(report.consistency,'stable');assert.equal(report.scopeStatus,'closed');assert.equal(report.scopeOutcome,'completed');assert.deepEqual(report.issues,[]);
  assert.equal(report.totals.registeredRuns,first?3:1);assert.equal(report.totals.readRuns,first?3:1);assert.equal(report.totals.inFlightRuns,0);assert.equal(report.totals.missingUsageRuns,0);assert.equal(report.totals.partialUsageRuns,0);assert.equal(report.totals.unpricedRuns,0);assert.equal(report.totals.tokensComplete,true);assert.equal(report.totals.costComplete,true);
  assert.deepEqual(report.totals.tokens,{input:first?1600:100,output:first?320:20,cacheRead:0,cacheWrite:0,reasoning:0,total:first?1920:120});assert.ok(Math.abs(report.totals.estimatedCostUsd!-(first?0.00224:0.00014))<1e-12);
  assert.equal(report.runs.filter(run=>run.kind==='main').length,first?2:1);assert.equal(report.runs.filter(run=>run.kind==='member').length,first?1:0);assert.equal(new Set(report.runs.map(run=>run.runId)).size,report.runs.length);
  for(const run of report.runs){assert.equal(run.status,'completed');assert.equal(run.logState,'verified');assert.equal(run.usage.source,'run-summary');assert.equal(run.usage.tokensState,'reported');assert.equal(run.usage.costState,'priced');assert.deepEqual(run.usage.issues,[])}
  return report;
}

/** Reading time may change; all trusted ownership and metering facts must remain stable. */
export function stableScopeUsage(report:ScopeUsageReport){const {checkedAt,...stable}=report;return stable}
