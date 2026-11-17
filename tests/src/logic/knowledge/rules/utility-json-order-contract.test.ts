import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../../../../../src/logic/tasks/rules/execution-context';
import {workspacePackageFingerprint,type WorkspacePackage} from '../../../../../src/logic/knowledge/rules/portable-package';
import {sameGoalValue} from '../../../../../src/logic/tasks/rules/scope-goal';
import {workspaceMemberCanonical} from '../../../../../src/logic/team/rules/workspace-member-rules';
import {knowledgeSourceCanonical} from '../../../../../src/logic/workspace/rules/knowledge-source-rules';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
it('知识包保留本机 localeCompare 策略，原版本不迁移为字符序',()=>{
  const value={fingerprint:'old',a:2,Z:1} as unknown as WorkspacePackage;
  const originalOrder=Object.fromEntries([['a',2],['Z',1]].sort(([a],[b])=>String(a).localeCompare(String(b))));
  expect(workspacePackageFingerprint(value)).toBe(digest(JSON.stringify(originalOrder)));
});
