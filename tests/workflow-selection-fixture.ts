import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Application} from '../src/backend/main/application';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {request} from './helpers';
import {seedJsonValidation,jsonValidationRecords} from './json-validation-fixture';

/** Preserve Step22 defaults; only this setup mounts a second JSON workflow and explicitly selects it. */
export async function seedWorkflowSelection(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,workflow?:string)=>void}){
  const seeded=await seedJsonValidation(app,project,provider),workspace=app.workspace(seeded.entry.id),snapshot=await workspace.snapshot(),moduleId=seeded.team.input.moduleId,firstWorkflowId=seeded.team.input.workflowId,body=snapshot.files.find(file=>file.path===seeded.workflow)!.text;
  const preview=await seeded.team.call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'workflow',action:'create',parentId:moduleId,slug:'validate_json',data:{name:'明确JSON结构验证'},body}]}),workflowId=preview.objects[0] as string;
  await seeded.team.call('cbim_object_commit',{planId:preview.planId},true);const latest=await workspace.snapshot(),firstContract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'default-read',toolName:'read'}]}},firstText='# 默认只读证据流程\n\n第一项没有JSON验证出口，显式选择第二项才采用JSON条件。\n\n```cbim-workflow\n'+JSON.stringify(firstContract,null,2)+'\n```\n';
  await workspace.commit(request(latest,[{path:seeded.workflow,text:firstText}]));const current=await workspace.snapshot(),definition=JSON.parse(current.files.find(file=>file.path===moduleId+'/module.json')!.text);
  assert.equal(definition.workflows.length,2);assert.equal(moduleId+'/'+definition.workflows[0].reference,firstWorkflowId+'/workflow.md');assert.equal(moduleId+'/'+definition.workflows[1].reference,workflowId+'/workflow.md');assert.notEqual(workflowId,firstWorkflowId);provider.bind(seeded.team.input.agentId,moduleId,workflowId);
  return {...seeded,workflow:workflowId+'/workflow.md',selection:{moduleId,workflowId},firstWorkflowId,workflowVersion:createHash('sha256').update(body).digest('hex'),firstContract};
}

/** Check actual persisted goal/task/prepared/native provenance and result proof, without editing them. */
export async function assertWorkflowSelection(user:string,workspaceId:string,graph:GraphSnapshot,expected:{moduleId:string;workflowId:string},complete=false){
  const records=await jsonValidationRecords(user,workspaceId),scope=records.scopes[0],task=graph.tasks[0],run=records.runs[0];
  assert.deepEqual(scope.goal?.plan?.assignments[0].workflowSelections,[expected]);assert.deepEqual(task.workflowSelections,[expected]);assert.equal(task.modules[0].workflow.kind,'module');assert.equal(task.modules[0].workflow.id,expected.workflowId);assert.equal(run.prepared.modules[0].binding.workflow.id,expected.workflowId);assert.deepEqual(run.prepared.modules[0].binding,task.modules[0]);assert.ok(run.prepared.modules[0].workflowContract?.delivery?.requiredValidations?.length);assert.equal(run.prepared.modules[0].definition.workflows instanceof Array,true);
  const summary=await new FileRunStorage().read(path.join(user,workspaceId,'dispatch','runs','tasks',task.taskId,run.binding.runId)),contract=(summary.events[0].data.workflowContracts as Array<{moduleId:string;workflowId:string;workflowVersion:string}>)[0];assert.equal(contract.moduleId,expected.moduleId);assert.equal(contract.workflowId,expected.workflowId);assert.equal(contract.workflowVersion,task.modules[0].workflow.version);
  const validations=summary.events.filter(event=>event.type==='validation.checked');assert.ok(validations.length);for(const event of validations){const result=event.data.validation as {requirement:{moduleId:string;workflowId:string;workflowVersion:string}};assert.equal(result.requirement.moduleId,expected.moduleId);assert.equal(result.requirement.workflowId,expected.workflowId);assert.equal(result.requirement.workflowVersion,task.modules[0].workflow.version)}
  if(complete){assert.equal(task.status,'result_ready');assert.equal(summary.taskProgress?.delivery?.workflow?.validationChecks?.length,1);assert.equal(summary.taskProgress?.delivery?.workflow?.validationChecks?.[0].workflowId,expected.workflowId);assert.equal(summary.taskProgress?.delivery?.workflow?.checks[0].workflowId,expected.workflowId)}
  return {selection:expected,workflowVersion:task.modules[0].workflow.version,taskId:task.taskId,runId:run.binding.runId,validationCount:validations.length};
}
