import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberValidationPanel} from '../src/frontend/tasks/MemberValidationPanel';
import {memberValidationViews} from '../src/frontend/tasks/member-validation-state';
import {projectRunEvent} from '../src/logic/runtime/monitoring/public-run-events';
import type {RunSummary,StoredEvent} from '../src/logic/execution/rules/types';
import type {ValidationResult} from '../src/logic/evidence/rules/validation';

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

test('CSV公开投影和界面保留原验证器、位置与历史结论，不泄露原字段内容',()=>{
  const csv:ValidationResult={...result,validator:'csv-table-v1',artifact:{...result.artifact,relativePath:'inventory.csv'},outcome:'rejected',issues:[{code:'csv_value',instancePath:'/rows/1/1',keyword:'integer'},{code:'csv_duplicate',instancePath:'/rows/2',keyword:'uniqueBy'}]};
  const shown=projectRunEvent(event('validation.checked',3,{validation:csv}),identity,task),run=summary([shown,finished(),event('tool.allowed',5,{name:'write',id:'later'})]);
  expect(memberValidationViews(run)[0]).toMatchObject({state:'stale',result:{validator:'csv-table-v1',outcome:'rejected',issues:csv.issues}});
  const html=renderToStaticMarkup(createElement(MemberValidationPanel,{run}));expect(html).toContain('CSV 表格检查');expect(html).toContain('CSV 字段约束不符合');expect(html).toContain('CSV 唯一键重复');expect(html).toContain('/rows/1/1');expect(html).toContain('原结论：');expect(html).not.toContain('agentInstanceId');
  const wrong={...csv,validator:'json-schema-v1'};expect(projectRunEvent(event('validation.checked',3,{validation:wrong}),identity,task).type).toBe('engine.status');
});

test('PNG公开投影显示实际图片条件，不把失败改成其他验证器记录',()=>{
  const png:ValidationResult={...result,validator:'png-raster-v1',artifact:{...result.artifact,relativePath:'status-icon.png'},outcome:'rejected',issues:[{code:'png_dimensions',instancePath:'/IHDR',keyword:'dimensions'}]},shown=projectRunEvent(event('validation.checked',3,{validation:png}),identity,task),run=summary([shown,finished()]);
  expect(memberValidationViews(run)[0]).toMatchObject({state:'rejected',result:{validator:'png-raster-v1'}});const html=renderToStaticMarkup(createElement(MemberValidationPanel,{run}));expect(html).toContain('PNG 图片检查');expect(html).toContain('PNG 像素尺寸不符合');expect(html).not.toContain('pixels');expect(projectRunEvent(event('validation.checked',3,{validation:{...png,validator:'csv-table-v1'}}),identity,task).type).toBe('engine.status');
});
