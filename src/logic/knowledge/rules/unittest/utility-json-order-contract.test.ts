import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../../../tasks/rules/execution-context';
import {workspacePackageFingerprint,type WorkspacePackage} from '../portable-package';
import {sameGoalValue} from '../../../tasks/rules/scope-goal';
import {workspaceMemberCanonical} from '../../../team/rules/workspace-member-rules';
import {knowledgeSourceCanonical} from '../../../workspace/rules/knowledge-source-rules';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
it('知识包保留本机 localeCompare 策略，原版本不迁移为字符序',()=>{
  const value={fingerprint:'old',a:2,Z:1} as unknown as WorkspacePackage;
  const originalOrder=Object.fromEntries([['a',2],['Z',1]].sort(([a],[b])=>String(a).localeCompare(String(b))));
  expect(workspacePackageFingerprint(value)).toBe(digest(JSON.stringify(originalOrder)));
});
