import {expect,test} from 'vitest';
import {projectRunEvent} from '../src/backend/scheduler-engine/runtime/public-run-events';
import type {StoredEvent,TaskSpec} from '../src/backend/core/execution/types';

test('history keeps each main user input but never exposes executor startup prompts or mistakes result injection for user input',()=>{
  const identity={workspaceId:'workspace',taskId:'task',runId:'run'},task:TaskSpec={...identity,root:'/workspace',goal:'最初目标',moduleIds:[],acceptance:[],mode:'chat',agentId:'cbim:main'};
  const started:StoredEvent={...identity,version:1,seq:1,time:'2026-11-07T00:00:00.000Z',type:'run.started',data:{message:'第二轮用户补充',sessionFile:'PRIVATE_NATIVE_PATH',configuration:{prompt:'PRIVATE_PROMPT'}}};
  expect(projectRunEvent(started,identity,task).data.message).toBe('第二轮用户补充');
  const returned=projectRunEvent({...started,data:{...started.data,message:'PRIVATE_RESULT_PAYLOAD',source:{kind:'member-results',privateContext:'PRIVATE_CONTEXT'}}},identity,task);
  expect(returned.data).toMatchObject({message:'成员任务结果回注（系统数据）',source:{kind:'member-results'}});
  const member=projectRunEvent({...started,data:{message:'PRIVATE_EXECUTOR_PROMPT'}},identity,{...task,mode:undefined,agentId:'cbim:executor',moduleIds:['.cbim/workspace/game']});
  expect(member.data.message).toBe('最初目标');
  expect(JSON.stringify([projectRunEvent(started,identity,task),returned,member])).not.toContain('PRIVATE_');
});
