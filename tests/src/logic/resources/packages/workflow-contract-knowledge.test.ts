// logic/resources/packages: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {moduleFiles,request} from '../../knowledge/rules/data/knowledge';
import {buildWorkspacePackage,parseWorkspacePackage,planWorkspacePackage,workspacePackageFingerprint} from '../../../../../src/logic/knowledge/rules/portable-package';
import {hash} from '../../../../../src/core/platform/node/serialization';
import {parseWorkflowContract} from '../../../../../src/logic/workspace/rules/workflow-contract';

const body='# 实施与验证\n按专业方法执行。\n```cbim-workflow\n{"version":1,"beforeEffects":{"requirePlan":true},"delivery":{"requiredToolEvidence":[{"id":"inspect-result","toolName":"read"}]}}\n```\n成果语义仍由审阅者判断。';
const bad=body.replace('"version":1','"version":2');
const workflowPath='.cbim/workspace/game/workflows/implement/workflow.md';

it('完整业务模板原样携带条件，改指纹的坏声明仍不能导入或导出',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),files=moduleFiles(),definition=JSON.parse(files[0].text);
    definition.workflows=[{name:'实现',reference:'workflows/implement/workflow.md'}];files[0].text=JSON.stringify(definition);files.push({path:workflowPath,text:body,hash:hash(body)});await workspace.Commit(request(await workspace.Snapshot(),files));
    const snapshot=await workspace.Snapshot(),selection={kind:'architecture' as const,name:'业务模板',summary:'完整业务'};
    const built=buildWorkspacePackage(snapshot,selection).package;expect(parseWorkspacePackage(JSON.stringify(built)).files.find(file=>file.path.endsWith('/workflow.md'))!.text).toBe(body);
    const empty={...snapshot,files:snapshot.files.filter(file=>!file.path.startsWith('.cbim/workspace/'))};
    const planned=planWorkspacePackage(empty,built,{mode:'add'});expect(planned.changes).toContainEqual({path:workflowPath,text:body});
    const invalid=structuredClone(built);invalid.files.find(file=>file.path.endsWith('/workflow.md'))!.text=bad;invalid.fingerprint=workspacePackageFingerprint(invalid);
    expect(()=>parseWorkspacePackage(JSON.stringify(invalid))).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));expect(()=>planWorkspacePackage(empty,invalid,{mode:'add'})).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));
    const forged=structuredClone(snapshot);forged.files.find(file=>file.path===workflowPath)!.text=bad;expect(forged.validation!.structural).toBe(true);expect(()=>buildWorkspacePackage(forged,selection)).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));
  }finally{await f.cleanup()}
});
