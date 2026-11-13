import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../src/backend/core/tasks/execution-context';
import {workspacePackageFingerprint,type WorkspacePackage} from '../src/backend/core/knowledge/portable-package';
import {sameGoalValue} from '../src/backend/core/tasks/scope-goal';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
it('执行知识保留字符序指纹与根 fingerprint 排除，不排除嵌套同名字段',()=>{
  const value={fingerprint:'old',version:1,agentDefinition:{a:2,Z:1,fingerprint:'nested'}} as unknown as PreparedDispatchKnowledge;
  expect(dispatchKnowledgeFingerprint(value)).toBe(digest('{"agentDefinition":{"Z":1,"a":2,"fingerprint":"nested"},"version":1}'));
  expect(dispatchKnowledgeFingerprint({...value,fingerprint:'changed'})).toBe(dispatchKnowledgeFingerprint(value));
});
it('知识包保留本机 localeCompare 策略，原版本不迁移为字符序',()=>{
  const value={fingerprint:'old',a:2,Z:1} as unknown as WorkspacePackage;
  const originalOrder=Object.fromEntries([['a',2],['Z',1]].sort(([a],[b])=>String(a).localeCompare(String(b))));
  expect(workspacePackageFingerprint(value)).toBe(digest(JSON.stringify(originalOrder)));
});
it('目标值比较保持 undefined 字段忽略、数组顺序及危险键数据',()=>{
  expect(sameGoalValue({b:undefined,a:1},{a:1})).toBe(true);
  expect(sameGoalValue([1,2],[2,1])).toBe(false);
  expect(sameGoalValue(JSON.parse('{"__proto__":{"a":1}}'),{})).toBe(false);
});
