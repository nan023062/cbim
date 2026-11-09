import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,internalKnowledge,moduleFiles,request} from './helpers';
import {buildWorkspacePackage,parseWorkspacePackage,planWorkspacePackage,workspacePackageFingerprint} from '../src/backend/core/knowledge/portable-package';
import {hash} from '../src/backend/core/foundation/serialization';
import {parseWorkflowContract} from '../src/backend/core/workspace/workflow-contract';

const body='# 实施与验证\n按专业方法执行。\n```cbim-workflow\n{"version":1,"beforeEffects":{"requirePlan":true},"delivery":{"requiredToolEvidence":[{"id":"inspect-result","toolName":"read"}]}}\n```\n成果语义仍由审阅者判断。';
const bad=body.replace('"version":1','"version":2');
const workflowPath='.cbim/workspace/game/workflows/implement/workflow.md';

it('真实对象CRUD保存并读取原Workflow条件，坏声明在保存预览前拒绝',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),{call}=internalKnowledge(workspace);
    await workspace.commit(request(await workspace.snapshot(),moduleFiles()));
    const snapshot=await workspace.snapshot(),operation={kind:'workflow',action:'create',parentId:'.cbim/workspace/game',slug:'implement',data:{name:'实现与验证'},body};
    await expect(call('cbim_object_preview',{revision:snapshot.revision,operations:[{...operation,body:bad}]})).rejects.toMatchObject({code:'WORKFLOW_CONTRACT_INVALID'});
    expect((await workspace.snapshot()).revision).toBe(snapshot.revision);await expect(fs.access(path.join(f.a,workflowPath))).rejects.toThrow();
    const preview=await call('cbim_object_preview',{revision:snapshot.revision,operations:[operation]});expect(preview.validation.structural).toBe(true);
    const committed=await call('cbim_object_commit',{planId:preview.planId},true);expect(committed.revision).not.toBe(snapshot.revision);
    const detail=await call('cbim_module_get',{id:'.cbim/workspace/game'});expect(detail.workflows[0].content.text).toBe(body);expect(parseWorkflowContract(detail.workflows[0].content.text)?.beforeEffects?.requirePlan).toBe(true);
    await expect(call('cbim_object_preview',{revision:committed.revision,operations:[{kind:'workflow',action:'update',id:preview.objects[0],body:body+'\n'+body}]})).rejects.toMatchObject({code:'WORKFLOW_CONTRACT_INVALID'});
    expect(await fs.readFile(path.join(f.a,workflowPath),'utf8')).toBe(body);
  }finally{await f.cleanup()}
});

it('原始知识preview/commit不能绕过条件校验，无条件旧正文仍能正式保存',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),files=moduleFiles(),definition=JSON.parse(files[0].text);
    definition.workflows=[{name:'实现',reference:'workflows/implement/workflow.md'}];files[0].text=JSON.stringify(definition);files.push({path:workflowPath,text:body,hash:hash(body)});
    await workspace.commit(request(await workspace.snapshot(),files));const before=await workspace.snapshot(),attempt=request(before,[{path:workflowPath,text:bad}]);
    const preview=await workspace.preview(attempt);expect(preview.validation.structural).toBe(false);expect(preview.validation.issues).toContainEqual(expect.objectContaining({path:workflowPath,code:'workflow_contract',severity:'error'}));
    await expect(workspace.commit(attempt)).rejects.toMatchObject({code:'VALIDATION'});expect(await fs.readFile(path.join(f.a,workflowPath),'utf8')).toBe(body);expect((await workspace.snapshot()).revision).toBe(before.revision);
    const legacy='# 旧自然语言工作流\n由执行者选择合理的专业步骤。';await workspace.commit(request(await workspace.snapshot(),[{path:workflowPath,text:legacy}]));expect(parseWorkflowContract((await workspace.snapshot()).files.find(file=>file.path===workflowPath)!.text)).toBeUndefined();
  }finally{await f.cleanup()}
});

it('完整业务模板原样携带条件，改指纹的坏声明仍不能导入或导出',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),files=moduleFiles(),definition=JSON.parse(files[0].text);
    definition.workflows=[{name:'实现',reference:'workflows/implement/workflow.md'}];files[0].text=JSON.stringify(definition);files.push({path:workflowPath,text:body,hash:hash(body)});await workspace.commit(request(await workspace.snapshot(),files));
    const snapshot=await workspace.snapshot(),selection={kind:'architecture' as const,name:'业务模板',summary:'完整业务'};
    const built=buildWorkspacePackage(snapshot,selection).package;expect(parseWorkspacePackage(JSON.stringify(built)).files.find(file=>file.path.endsWith('/workflow.md'))!.text).toBe(body);
    const empty={...snapshot,files:snapshot.files.filter(file=>!file.path.startsWith('.cbim/workspace/'))};
    const planned=planWorkspacePackage(empty,built,{mode:'add'});expect(planned.changes).toContainEqual({path:workflowPath,text:body});
    const invalid=structuredClone(built);invalid.files.find(file=>file.path.endsWith('/workflow.md'))!.text=bad;invalid.fingerprint=workspacePackageFingerprint(invalid);
    expect(()=>parseWorkspacePackage(JSON.stringify(invalid))).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));expect(()=>planWorkspacePackage(empty,invalid,{mode:'add'})).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));
    const forged=structuredClone(snapshot);forged.files.find(file=>file.path===workflowPath)!.text=bad;expect(forged.validation!.structural).toBe(true);expect(()=>buildWorkspacePackage(forged,selection)).toThrowError(expect.objectContaining({code:'RESOURCE_PACKAGE'}));
  }finally{await f.cleanup()}
});
