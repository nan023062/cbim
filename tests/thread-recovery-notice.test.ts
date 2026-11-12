import {expect,test} from 'vitest';
import type {RunSummary} from '../src/bridge/contracts/execution';
import {threadRecoveryReason,threadResumeRun} from '../src/frontend/conversation/ThreadHistoryNotice';

const run=(extra:Partial<RunSummary>={}):RunSummary=>({runId:'current',status:'interrupted',sessionFile:'native.jsonl',unresolvedTools:[],logIntegrity:{partialTail:false},...extra} as RunSummary);

test('有可靠文件的中断可发送；缺登记、未决工具或坏日志明确说明原因',()=>{
  expect(threadRecoveryReason(run())).toBeUndefined();
  expect(threadRecoveryReason(run({sessionFile:undefined}))).toContain('未登记');
  expect(threadRecoveryReason(run({unresolvedTools:['call']}))).toContain('尚未确认');
  expect(threadRecoveryReason(run({logIntegrity:{partialTail:true}}))).toContain('日志不完整');
});

test('原运行头缺失不退回旧文件，新对话无须借旧运行恢复',()=>{
  const old=run({runId:'old'});
  expect(threadResumeRun([old],'missing')).toBeUndefined();
  expect(threadRecoveryReason(threadResumeRun([old],'missing'))).toContain('没有可安全续接');
  expect(threadResumeRun([old,run({sessionFile:undefined})],'current')?.sessionFile).toBeUndefined();
});
