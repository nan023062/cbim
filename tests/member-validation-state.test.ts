import {expect,test} from 'vitest';
import {memberValidationViews} from '../src/frontend/tasks/member-validation-state';
import {projectRunEvent} from '../src/backend/scheduler-engine/execution/public-run-events';
import type {RunSummary,StoredEvent} from '../src/backend/core/brain/types';
import type {ValidationResult} from '../src/backend/core/tasks/validation';

const identity={workspaceId:'workspace',taskId:'task',runId:'run'},now='2026-11-07T00:00:00.000Z',digest='a'.repeat(64);
const task={workspaceId:identity.workspaceId,taskId:identity.taskId,root:'/workspace',goal:'核对结构',moduleIds:['module'],agentId:'agent',acceptance:['字段符合要求']};
const result:ValidationResult={version:1,validationId:'validation',toolCallId:'call',binding:{...identity,teamId:'team',agentId:'agent',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',leaseEpoch:1,planRevision:1},validator:'json-schema-v1',requirement:{moduleId:'module',workflowId:'flow',workflowVersion:'1',requirementId:'shape',schemaHash:digest},knowledgeRevision:'knowledge',taskProgressVersion:2,baselineId:'baseline',artifact:{relativePath:'out/result.json',byteLength:12,sha256:digest},lastEffectSeq:2,checkedAt:now,outcome:'passed',issues:[]};
const event=(type:StoredEvent['type'],seq:number,data:StoredEvent['data']):StoredEvent=>({version:1,...identity,type,seq,time:now,data});
function summary(events:StoredEvent[]):RunSummary{return {task,runId:identity.runId,status:'completed',acceptance:'not_evaluated',events,unresolvedTools:[]}}
const checked=()=>projectRunEvent(event('validation.checked',3,{validation:result}),identity,task);
const finished=(outcome='succeeded')=>event('tool.finished',4,{id:'call',name:'cbim_validation_run',isError:outcome!=='succeeded',receipt:{...identity,toolName:'cbim_validation_run',toolCallId:'call',outcome}});

test('staged passed waits for the same real tool completion; failure and duplicate receipt do not confirm it',()=>{
  expect(memberValidationViews(summary([checked()]))[0].state).toBe('unconfirmed');
  expect(memberValidationViews(summary([checked(),finished('failed')]))[0].state).toBe('unconfirmed');
  expect(memberValidationViews(summary([checked(),finished(),finished()]))[0].state).toBe('unconfirmed');
  expect(memberValidationViews(summary([checked(),checked(),finished()]))[0].state).toBe('unconfirmed');
  const wrong=finished();wrong.data.receipt={...wrong.data.receipt as object,runId:'other'};
  expect(memberValidationViews(summary([checked(),wrong]))[0].state).toBe('unconfirmed');
  expect(memberValidationViews(summary([checked(),finished()]))[0].state).toBe('passed');
});

test('historical rejected stays original rejected while a later write marks the display stale',()=>{
  const rejected=projectRunEvent(event('validation.checked',3,{validation:{...result,outcome:'rejected',issues:[{code:'schema_mismatch',instancePath:'/count',keyword:'type'}]}}),identity,task);
  const before=memberValidationViews(summary([rejected,finished()]));expect(before[0].state).toBe('rejected');
  const after=memberValidationViews(summary([rejected,finished(),event('tool.allowed',5,{name:'write',id:'later'})]));
  expect(after[0].state).toBe('stale');expect(after[0].result.outcome).toBe('rejected');
  expect(memberValidationViews(summary([checked(),finished(),event('tool.allowed',5,{name:'read'})]))[0].state).toBe('passed');
});

test('projection hides private fields and rejects cross-run or malformed proof rather than repairing it',()=>{
  const shown=checked();expect(shown.type).toBe('validation.checked');
  const json=JSON.stringify(shown);expect(json).not.toContain('agentInstanceId');expect(json).not.toContain('knowledgeRevision');expect(json).not.toContain('leaseEpoch');
  const bad=[{...result,binding:{...result.binding,runId:'other'}},{...result,schema:{secret:'PRIVATE'}},{...result,outcome:'passed',issues:[{code:'json_invalid',instancePath:''}]}];
  for(const value of bad){const hidden=projectRunEvent(event('validation.checked',3,{validation:value}),identity,task);expect(hidden.type).toBe('engine.status');expect(JSON.stringify(hidden)).not.toContain('PRIVATE')}
  const other={...checked(),runId:'other'};expect(memberValidationViews(summary([other,finished()]))).toEqual([]);
});
test('complete validation projection preserves only the exact original collection identity',()=>{
  const {baselineId:_,...rest}=result,manifest={manifestId:'complete-one',scopeHash:digest,manifestHash:'b'.repeat(64)},shown=projectRunEvent(event('validation.checked',3,{validation:{...rest,manifest}}),identity,task);
  expect((shown.data.validation as any).manifest).toEqual(manifest);expect(memberValidationViews(summary([shown,finished()]))[0].result.manifest).toEqual(manifest);expect(JSON.stringify(shown)).not.toContain('knowledgeRevision');expect(JSON.stringify(shown)).not.toContain('binding');
  expect(projectRunEvent(event('validation.checked',3,{validation:{...result,manifest}}),identity,task).type).toBe('engine.status');
});
