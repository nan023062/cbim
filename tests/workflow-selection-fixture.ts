import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Application} from '../src/bridge/server/application';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {request} from './data/knowledge';
import {seedJsonValidation} from './json-validation-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {jsonValidationFixture} from './json-validation-provider';

/** Preserve Step22 defaults; only this setup mounts a second JSON workflow and explicitly selects it. */
export async function seedWorkflowSelection(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,workflow?:string,selection?:OwnerExecutionSelection)=>void}){
  const seeded=await seedJsonValidation(app,project,provider,{deferOwner:true}),workspace=app.Workspace(seeded.entry.id),snapshot=await workspace.Snapshot(),moduleId=seeded.team.input.moduleId,firstWorkflowId=seeded.team.input.workflowId,body=snapshot.files.find(file=>file.path===seeded.workflow)!.text;
  const preview=await seeded.team.call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'workflow',action:'create',parentId:moduleId,slug:'validate_json',data:{name:'明确JSON结构验证'},body}]}),workflowId=preview.objects[0] as string;
  await seeded.team.call('cbim_object_commit',{planId:preview.planId},true);const latest=await workspace.Snapshot(),firstContract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'default-read',toolName:'read'}]}},firstText='# 默认只读证据流程\n\n第一项没有JSON验证出口，显式选择第二项才采用JSON条件。\n\n```cbim-workflow\n'+JSON.stringify(firstContract,null,2)+'\n```\n';
  await workspace.Commit(request(latest,[{path:seeded.workflow,text:firstText}]));const current=await workspace.Snapshot(),definition=JSON.parse(current.files.find(file=>file.path===moduleId+'/module.json')!.text);
  assert.equal(definition.workflows.length,2);assert.equal(moduleId+'/'+definition.workflows[0].reference,firstWorkflowId+'/workflow.md');assert.equal(moduleId+'/'+definition.workflows[1].reference,workflowId+'/workflow.md');assert.notEqual(workflowId,firstWorkflowId);
  const owner=await registerExplicitFixtureOwner(app,seeded.entry.id,{agentId:seeded.team.input.agentId,moduleIds:[moduleId],profileId:seeded.profileId,modelId:jsonValidationFixture.model,name:'显式第二流程岗位'});provider.bind(seeded.team.input.agentId,moduleId,workflowId,owner.selection);
  return {...seeded,owner,workflow:workflowId+'/workflow.md',selection:{moduleId,workflowId},firstWorkflowId,workflowVersion:createHash('sha256').update(body).digest('hex'),firstContract};
}

/** Read the real child through its parent tool reference; never reconstruct retired dispatch state. */
export async function assertWorkflowSelection(user:string,workspaceId:string,root:{taskId:string;runId:string},expected:{moduleId:string;workflowId:string},complete=false){
  const directory=path.join(user,workspaceId,'loop-engine','tasks'),storage=new FileRunStorage();
  const parent=await storage.Read(path.join(directory,root.taskId,root.runId));
  const reference=parent.events.find(event=>event.type==='tool.updated'&&event.data.agentCall)?.data.agentCall as {taskId:string;runId:string}|undefined;
  assert.ok(reference,'Parent must persist the actual child reference');
  const summary=await storage.Read(path.join(directory,reference.taskId,reference.runId));
  assert.deepEqual(summary.events[0].data.agentCall,{version:1,workspaceId,taskId:reference.taskId,runId:reference.runId,callerTaskId:root.taskId,callerRunId:root.runId,toolCallId:'json-agent-call'});
  const contracts=summary.events[0].data.workflowContracts as Array<{moduleId:string;workflowId:string;workflowVersion:string}>;
  assert.equal(contracts.length,1);const contract=contracts[0];
  assert.equal(contract.moduleId,expected.moduleId);assert.equal(contract.workflowId,expected.workflowId);
  assert.ok(contract.workflowVersion);
  const validations=summary.events.filter(event=>event.type==='validation.checked');
  assert.ok(validations.length);
  for(const event of validations){
    const result=event.data.validation as {requirement:{moduleId:string;workflowId:string;workflowVersion:string}};
    assert.equal(result.requirement.moduleId,expected.moduleId);
    assert.equal(result.requirement.workflowId,expected.workflowId);
    assert.equal(result.requirement.workflowVersion,contract.workflowVersion);
  }
  if(complete){
    assert.equal(summary.status,'completed');
    assert.equal(summary.taskProgress?.delivery?.workflow?.validationChecks?.length,1);
    assert.equal(summary.taskProgress?.delivery?.workflow?.validationChecks?.[0].workflowId,expected.workflowId);
    assert.equal(summary.taskProgress?.delivery?.workflow?.checks[0].workflowId,expected.workflowId);
  }
  return {selection:expected,workflowVersion:contract.workflowVersion,taskId:reference.taskId,runId:reference.runId,validationCount:validations.length};
}
