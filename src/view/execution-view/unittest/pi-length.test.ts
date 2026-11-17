// view/execution-view: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {test,expect} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../logic/application/unittest/support/helpers';
import {modelStopError} from '../../../logic/execution/rules/model-errors';
import {transcript} from '../transcript';
test('length is actionable, reports usage, and old logs are readable without rewriting',()=>{
 expect(modelStopError({stopReason:'length',usage:{output:4096,reasoning:4096}},4096)).toContain('推理 4096');
 expect(modelStopError({stopReason:'stop'})).toBeUndefined();
 const items=transcript({runId:'r',task:{goal:'create'} as any,status:'failed',acceptance:'not_evaluated',unresolvedTools:[],events:[{type:'run.started',data:{}},{type:'message',data:{text:'',stopReason:'length',usage:{output:4096,reasoning:4096}}},{type:'run.settled',data:{status:'failed',error:'length'}}] as any});
 expect(items.at(-1)?.text).toContain('不能确定');expect(items.at(-1)?.text).toContain('4096');
 expect(modelStopError({stopReason:'length',usage:{output:13320,reasoning:7425}},16384)).toContain('不要只提高最大输出');
});
