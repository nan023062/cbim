import {expect,it} from 'vitest';
import {publicRunFailure} from '../src/backend/core/execution/run-failure';
import {projectRunEvent} from '../src/backend/scheduler-engine/runtime/public-run-events';
import type {StoredEvent,TaskSpec} from '../src/backend/core/execution/types';

it.each([
  ['Pi 连续 30 分钟无执行进展，已中断；请核实未确认的操作与产物。','30 分钟无执行进展'],
  ['执行超时，结果需核实，不自动重放','执行超时'],
  ['Pi 事件超过大小限制','Pi 事件超过大小限制'],
  ['Codex 进程提前退出 (7)','Codex 进程提前退出（7）'],
  ['模型返回长度限制（length），本次回复被截断。配置的最大输出为 16384 token。本次输出 16384 token。','配置上限 16384 token'],
  ['HTTP 401 PRIVATE_KEY https://private.example','认证或访问被拒绝'],
  ['HTTP 429 PRIVATE_KEY','限流'],
  ['ECONNRESET PRIVATE_FILE','模型连接异常'],
  ['PRIVATE_UNKNOWN_ERROR','详细原因保留在原运行记录'],
])('公开失败诊断保留已识别原因而不透传私密正文：%s',(error,expected)=>{
  const message=publicRunFailure(error);expect(message).toContain(expected);expect(message).not.toMatch(/PRIVATE_|https:\/\//);
  for(const type of ['run.interrupted','run.settled'] as const){
    const identity={workspaceId:'workspace',taskId:'task',runId:'run'},task:TaskSpec={...identity,goal:'test',root:process.cwd(),moduleIds:[],acceptance:[]};
    const event={...identity,type,version:1,seq:1,time:'2026-11-13T06:00:00Z',data:{error,status:'failed',unresolvedTools:['call']}} as StoredEvent;
    const projected=projectRunEvent(event,identity,task);expect(projected.data.error).toBe(message);
    if(type==='run.interrupted')expect(projected.data.unresolvedTools).toEqual(['call']);expect(event.data.error).toBe(error);
  }
});

it('没有错误不补造诊断，私密尾部不能冒充可信固定错误',()=>{
  expect(publicRunFailure(undefined)).toBeUndefined();
  expect(publicRunFailure('Pi 事件超过大小限制 PRIVATE_KEY')).not.toContain('PRIVATE_KEY');
});
