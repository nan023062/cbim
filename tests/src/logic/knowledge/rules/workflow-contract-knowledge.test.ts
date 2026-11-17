// logic/knowledge/rules: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {moduleFiles,request} from './data/knowledge';
import {buildWorkspacePackage,parseWorkspacePackage,planWorkspacePackage,workspacePackageFingerprint} from '../../../../../src/logic/knowledge/rules/portable-package';
import {hash} from '../../../../../src/core/platform/node/serialization';
import {parseWorkflowContract} from '../../../../../src/logic/workspace/rules/workflow-contract';

const body='# 实施与验证\n按专业方法执行。\n```cbim-workflow\n{"version":1,"beforeEffects":{"requirePlan":true},"delivery":{"requiredToolEvidence":[{"id":"inspect-result","toolName":"read"}]}}\n```\n成果语义仍由审阅者判断。';
const bad=body.replace('"version":1','"version":2');
const workflowPath='.cbim/workspace/game/workflows/implement/workflow.md';

it('真实对象CRUD保存并读取原Workflow条件，坏声明在保存预览前拒绝',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),{call}=internalKnowledge(workspace);
    await workspace.Commit(request(await workspace.Snapshot(),moduleFiles()));
    const snapshot=await workspace.Snapshot(),operation={kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'implement',data:{name:'实现与验证'},body};
    await expect(call('cbim_object_preview',{revision:snapshot.revision,operations:[{...operation,body:bad}]})).rejects.toMatchObject({code:'WORKFLOW_CONTRACT_INVALID'});
    expect((await workspace.Snapshot()).revision).toBe(snapshot.revision);await expect(fs.access(path.join(f.a,workflowPath))).rejects.toThrow();
    const preview=await call('cbim_object_preview',{revision:snapshot.revision,operations:[operation]});expect(preview.validation.structural).toBe(true);
    const committed=await call('cbim_object_commit',{planId:preview.planId},true);expect(committed.revision).not.toBe(snapshot.revision);
    const detail=await call('cbim_module_get',{id:'.cbim/workspace/game'});expect(detail.workflows[0].content.text).toBe(body);expect(parseWorkflowContract(detail.workflows[0].content.text)?.beforeEffects?.requirePlan).toBe(true);
    await expect(call('cbim_object_preview',{revision:committed.revision,operations:[{kind:'workflow',action:'update',id:preview.objects[0],body:body+'\n'+body}]})).rejects.toMatchObject({code:'WORKFLOW_CONTRACT_INVALID'});
    expect(await fs.readFile(path.join(f.a,workflowPath),'utf8')).toBe(body);
  }finally{await f.cleanup()}
});
