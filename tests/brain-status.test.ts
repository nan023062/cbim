import {test,expect} from 'vitest';
import {brainStatus} from '../src/frontend/conversation/brain-status';
import type {RunSummary} from '../src/logic/execution/rules/types';
test('brain activity ignores telemetry and never needs reasoning text',()=>{
 const run={status:'running',events:[{type:'engine.status',data:{metric:'activity',label:'正在思考…'}},{type:'engine.status',data:{metric:'context',tokens:100}}]} as unknown as RunSummary;
 expect(brainStatus(run)).toBe('正在思考…');run.events.push({type:'tool.started',data:{name:'write'}} as any);expect(brainStatus(run)).toBe('正在写文件…');expect(brainStatus(run,true)).toBe('等待确认…');run.events.push({type:'tool.finished',data:{name:'write'}} as any);expect(brainStatus(run)).toBe('正在思考…');run.status='cancelled';expect(brainStatus(run)).toBe('已停止');
});
