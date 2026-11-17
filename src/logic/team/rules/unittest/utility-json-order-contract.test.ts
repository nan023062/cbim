import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {dispatchKnowledgeFingerprint,type PreparedDispatchKnowledge} from '../../../tasks/rules/execution-context';
import {workspacePackageFingerprint,type WorkspacePackage} from '../../../knowledge/rules/portable-package';
import {sameGoalValue} from '../../../tasks/rules/scope-goal';
import {workspaceMemberCanonical} from '../workspace-member-rules';
import {knowledgeSourceCanonical} from '../../../workspace/rules/knowledge-source-rules';

it('岗位与知识来源保留原字符序、数字键与 undefined 字节',()=>{
  const value={z:undefined,a:[undefined,{é:2,Z:1}],10:'ten',2:'two'};
  const expected='{"2":"two","10":"ten","a":[null,{"Z":1,"é":2}]}';
  expect(workspaceMemberCanonical(value)).toBe(expected);
  expect(()=>workspaceMemberCanonical({value:1n})).toThrow();
});

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
