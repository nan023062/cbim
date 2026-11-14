import {expect,it} from 'vitest';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {moduleFiles,request,summary} from './data/knowledge';
import {parseJson} from '../src/core/json';

it('真实 ObjectCRUD 可连续创建两个 Workflow，uniqueItems 仍拒绝重复且不改已存知识',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),{call}=internalKnowledge(workspace);
    const mutate=async(operations:unknown[])=>{const snapshot=await call('cbim_knowledge_snapshot'),preview=await call('cbim_object_preview',{revision:snapshot.revision,operations});expect(preview.validation.structural).toBe(true);await call('cbim_object_commit',{planId:preview.planId},true);return preview.objects as string[]};
    const [moduleId]=await mutate([{kind:'module',action:'create',parentId:'.cbim/workspace',slug:'game',data:{summary},body:moduleFiles('game')[1].text}]);
    const [first]=await mutate([{kind:'workflow',action:'create',parentId:moduleId,slug:'build',data:{name:'默认构建'},body:'# 默认构建'}]);
    const [second]=await mutate([{kind:'workflow',action:'create',parentId:moduleId,slug:'validate_json',data:{name:'JSON 验证'},body:'# JSON 验证'}]);
    const detail=await call('cbim_module_get',{id:moduleId});expect(detail.workflows.map((item:{id:string})=>item.id)).toEqual([first,second]);
    const before=await workspace.snapshot(),file=before.files.find(item=>item.path===moduleId+'/module.json')!,definition=JSON.parse(file.text);
    const duplicate={...definition,workflows:[definition.workflows[0],{reference:definition.workflows[0].reference,name:definition.workflows[0].name}]};
    const invalid=request(before,[{path:file.path,text:JSON.stringify(duplicate)}]),preview=await workspace.preview(invalid);
    expect(preview.validation.structural).toBe(false);expect(preview.validation.issues.some(issue=>issue.code==='schema'&&issue.message.includes('duplicate'))).toBe(true);
    await expect(workspace.commit(invalid)).rejects.toMatchObject({code:'VALIDATION'});
    const after=await workspace.snapshot();expect(after.revision).toBe(before.revision);expect(after.files.find(item=>item.path===file.path)!.text).toBe(file.text);
  }finally{await f.cleanup()}
});

it('Ajv 兼容副本不裁剪危险 own keys，畸形多对象和重复 JSON 字段仍返回结构诊断',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),base=await workspace.snapshot(),files=moduleFiles(),moduleFile=files[0],definition=JSON.parse(moduleFile.text);
    const first={name:'Build',reference:'workflows/build/workflow.md'},second={name:'Verify',reference:'workflows/verify/workflow.md'};
    const raw='{"__proto__":{"polluted":true},"constructor":null,"valueOf":null,"toString":null}';
    const fact=parseJson(raw);expect(Object.getPrototypeOf(fact)).toBeNull();expect(Object.hasOwn(fact,'__proto__')).toBe(true);expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
    for(const key of ['valueOf','toString','constructor','__proto__']){
      const bad=JSON.parse('{'+JSON.stringify(key)+':null}'),text=JSON.stringify({...definition,workflows:[first,{...second,...bad}]});
      const report=await f.app.rules.validate(f.a,[...base.files,{...moduleFile,text},files[1]]);
      expect(report.structural,key).toBe(false);expect(report.issues.some(issue=>issue.code==='schema'),key).toBe(true);
    }
    const duplicate=JSON.stringify({...definition,workflows:[first,second]}).replace('"name":"Build"','"name":"Build","name":"Other"');
    const report=await f.app.rules.validate(f.a,[...base.files,{...moduleFile,text:duplicate},files[1]]);expect(report.structural).toBe(false);expect(report.issues.some(issue=>issue.code==='json'&&issue.message.includes('重复'))).toBe(true);
    expect((await workspace.snapshot()).revision).toBe(base.revision);expect(Object.getPrototypeOf(fact)).toBeNull();expect(Object.hasOwn(fact,'__proto__')).toBe(true);
  }finally{await f.cleanup()}
});
