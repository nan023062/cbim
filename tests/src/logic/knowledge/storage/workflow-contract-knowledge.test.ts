// logic/knowledge/storage: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {moduleFiles,request} from '../rules/data/knowledge';
import {buildWorkspacePackage,parseWorkspacePackage,planWorkspacePackage,workspacePackageFingerprint} from '../../../../../src/logic/knowledge/rules/portable-package';
import {hash} from '../../../../../src/core/platform/node/serialization';
import {parseWorkflowContract} from '../../../../../src/logic/workspace/rules/workflow-contract';

const body='# 实施与验证\n按专业方法执行。\n```cbim-workflow\n{"version":1,"beforeEffects":{"requirePlan":true},"delivery":{"requiredToolEvidence":[{"id":"inspect-result","toolName":"read"}]}}\n```\n成果语义仍由审阅者判断。';
const bad=body.replace('"version":1','"version":2');
const workflowPath='.cbim/workspace/game/workflows/implement/workflow.md';

it('原始知识preview/commit不能绕过条件校验，无条件旧正文仍能正式保存',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),files=moduleFiles(),definition=JSON.parse(files[0].text);
    definition.workflows=[{name:'实现',reference:'workflows/implement/workflow.md'}];files[0].text=JSON.stringify(definition);files.push({path:workflowPath,text:body,hash:hash(body)});
    await workspace.Commit(request(await workspace.Snapshot(),files));const before=await workspace.Snapshot(),attempt=request(before,[{path:workflowPath,text:bad}]);
    const preview=await workspace.Preview(attempt);expect(preview.validation.structural).toBe(false);expect(preview.validation.issues).toContainEqual(expect.objectContaining({path:workflowPath,code:'workflow_contract',severity:'error'}));
    await expect(workspace.Commit(attempt)).rejects.toMatchObject({code:'VALIDATION'});expect(await fs.readFile(path.join(f.a,workflowPath),'utf8')).toBe(body);expect((await workspace.Snapshot()).revision).toBe(before.revision);
    const legacy='# 旧自然语言工作流\n由执行者选择合理的专业步骤。';await workspace.Commit(request(await workspace.Snapshot(),[{path:workflowPath,text:legacy}]));expect(parseWorkflowContract((await workspace.Snapshot()).files.find(file=>file.path===workflowPath)!.text)).toBeUndefined();
  }finally{await f.cleanup()}
});
