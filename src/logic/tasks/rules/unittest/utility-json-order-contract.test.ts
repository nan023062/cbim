import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../execution-context';
import {workspacePackageFingerprint,type WorkspacePackage} from '../../../knowledge/rules/portable-package';
import {sameGoalValue} from '../scope-goal';
import {workspaceMemberCanonical} from '../../../team/rules/workspace-member-rules';
import {knowledgeSourceCanonical} from '../../../workspace/rules/knowledge-source-rules';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
it('执行知识保留字符序指纹与根 fingerprint 排除，不排除嵌套同名字段',()=>{
  const value={fingerprint:'old',version:1,agentDefinition:{a:2,Z:1,fingerprint:'nested'}} as unknown as PreparedDispatchKnowledge;
  expect(dispatchKnowledgeFingerprint(value)).toBe(digest('{"agentDefinition":{"Z":1,"a":2,"fingerprint":"nested"},"version":1}'));
  expect(dispatchKnowledgeFingerprint({...value,fingerprint:'changed'})).toBe(dispatchKnowledgeFingerprint(value));
});
it('目标值比较保持 undefined 字段忽略、数组顺序及危险键数据',()=>{
  expect(sameGoalValue({b:undefined,a:1},{a:1})).toBe(true);
  expect(sameGoalValue([1,2],[2,1])).toBe(false);
  expect(sameGoalValue(JSON.parse('{"__proto__":{"a":1}}'),{})).toBe(false);
});
