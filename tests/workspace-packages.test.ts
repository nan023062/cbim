import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {request,moduleFiles} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {buildWorkspacePackage,parseWorkspacePackage,workspacePackageFingerprint,type WorkspacePackage} from '../src/backend/core/knowledge/portable-package';
import {WorkspacePackages} from '../src/backend/main/resources/workspace-packages';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';

async function setup(){
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b}),source=f.app.workspace(a.id),target=f.app.workspace(b.id),team=await seedTeam(source);
    const repo=path.join(f.temp,'repo');await fs.mkdir(repo);await f.app.resources.configure({mode:'local',location:repo});
    const service=()=>new WorkspacePackages(target,f.app.resources);
    const publish=async(kind:'team'|'agent'|'skill'|'architecture',objectId?:string)=>{const snapshot=await source.snapshot(),repository=await f.app.resources.read();return new WorkspacePackages(source,f.app.resources).publish({workspaceId:a.id,instanceId:source.instanceId,revision:snapshot.revision,repositoryId:repository.repositoryId,repositoryRevision:repository.revision,kind,objectId,name:kind,summary:'复用资源'})};
    const preview=async(resourceId:string,extra:Record<string,unknown>={})=>{const snapshot=await target.snapshot(),repository=await f.app.resources.read();return service().preview({workspaceId:b.id,instanceId:target.instanceId,revision:snapshot.revision,repositoryId:repository.repositoryId,repositoryRevision:repository.revision,resourceId,...extra})};
    const commit=(planId:string)=>service().commit({workspaceId:b.id,instanceId:target.instanceId,planId});
    return {...f,source,target,team,publish,preview,commit,service};
  }catch(error){await f.cleanup();throw error}
}

it('Team 和 Agent 导出移除本机引擎/模型引用，源定义与专业原则保持原样',async()=>{
  const f=await setup();try{
    const snapshot=await f.source.snapshot(),file=snapshot.files.find(item=>item.path===f.team.input.agentId+'/agent.json')!,data=JSON.parse(file.text);
    data.runtime={engine:'claude-code',profileId:'12345678-1234-1234-1234-123456789012',modelId:'private-local-model'};
    await f.source.commit(request(snapshot,[{path:file.path,text:json(data)}]));const source=await f.source.snapshot();
    for(const kind of ['team','agent'] as const){
      const pack=buildWorkspacePackage(source,{kind,...(kind==='agent'?{objectId:f.team.input.agentId}:{}),name:'portable',summary:''}).package;
      expect(parseWorkspacePackage(JSON.stringify(pack)).kind).toBe(kind);
      expect(JSON.stringify(pack)).not.toContain(data.runtime.profileId);expect(JSON.stringify(pack)).not.toContain(data.runtime.modelId);
      expect(pack.files.filter(item=>item.path.endsWith('/agent.json')).every(item=>!Object.hasOwn(JSON.parse(item.text),'runtime'))).toBe(true);
    }
    expect((await f.source.snapshot()).files).toEqual(source.files);
  }finally{await f.cleanup()}
});

it('重开后旧已提交包只查原 journal 和索引回执，不复活旧实例未提交计划',async()=>{
  const f=await setup();let reopened:Application|undefined;try{
    const published=await f.publish('team'),done=await f.preview(published.resourceId,{slug:'complete'}),pending=await f.preview(published.resourceId,{slug:'unaccepted'}),receipt=await f.commit(done.planId);
    const id=f.target.entry.id,dir=path.join(f.user,id,'transactions'),evidence=async()=>Promise.all((await fs.readdir(dir)).sort().map(async name=>[name,await fs.readFile(path.join(dir,name),'utf8')]));
    const before=await evidence();await f.app.shutdown();reopened=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await reopened.init();
    const w=reopened.workspace(id),service=new WorkspacePackages(w,reopened.resources);
    expect(await service.commit({workspaceId:id,instanceId:w.instanceId,planId:done.planId})).toEqual(receipt);expect(await evidence()).toEqual(before);
    await expect(service.commit({workspaceId:id,instanceId:w.instanceId,planId:pending.planId})).rejects.toMatchObject({code:'STALE_INSTANCE'});expect(await evidence()).toEqual(before);
  }finally{if(reopened)await reopened.shutdown();await f.cleanup()}
});

it('团队整包只发布静态定义，持久化预览无正式写入；跨门面并发重试只有一个回执',async()=>{
  const f=await setup();try{
    const published=await f.publish('team'),repo=published.repository,before=await f.target.read();
    expect(repo.items.find(item=>item.id===published.resourceId)!.kind).toBe('team');
    const pack=parseWorkspacePackage(repo.items[0].content,'team');
    expect(pack.files.some(file=>file.path==='team/dev/agent.json')).toBe(true);
    expect(pack.files.some(file=>/people|registry|module|session|dispatch/.test(file.path))).toBe(false);
    const plan=await f.preview(published.resourceId,{slug:'imported'});expect(plan.validation.structural).toBe(true);expect((await f.target.read()).revision).toBe(before.revision);
    const [one,two]=await Promise.all([f.commit(plan.planId),f.commit(plan.planId)]);expect(two).toEqual(one);expect(await f.commit(plan.planId)).toEqual(one);
    const after=await f.target.snapshot();expect(after.validation!.structural).toBe(true);
    expect(after.validation!.skills!['.cbim/team/imported/dev'].entries.map(skill=>skill.name)).toEqual(['coding','review']);
    expect(after.files.filter(file=>file.path.startsWith('.cbim/workspace/'))).toEqual(before.files.filter(file=>file.path.startsWith('.cbim/workspace/')));
    const same=await f.publish('team');expect(same.resourceId).toBe(published.resourceId);expect(same.repository.items).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('独立 Agent 冻结祖先 Skill，单 Skill 登记到归属清单，不迁移项目人员或权限',async()=>{
  const f=await setup();try{
    const snap=await f.source.snapshot(),agent=snap.files.find(file=>file.path===f.team.input.agentId+'/agent.json')!,definition=JSON.parse(agent.text);definition.authors=['owner'];
    await f.source.commit(request(snap,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'源项目负责人',team:'.cbim/team'}]})},{path:agent.path,text:json(definition)}]));
    const published=await f.publish('agent',f.team.input.agentId),pack=parseWorkspacePackage(published.repository.items[0].content);
    const portable=JSON.parse(pack.files.find(file=>file.path==='agent/agent.json')!.text);expect(portable.authors).toEqual([]);expect(portable.connectors).toEqual([]);expect(portable.skills.map((item:any)=>item.name)).toEqual(['coding','review']);
    expect(json(pack)).not.toContain('源项目负责人');const plan=await f.preview(published.resourceId,{slug:'developer'});expect(plan.validation.structural).toBe(true);await f.commit(plan.planId);
    const skill=await f.publish('skill',f.team.shared),skillPlan=await f.preview(skill.resourceId,{slug:'team_review'});expect(skillPlan.validation.structural).toBe(false); // 与已导入成员自己的 review 同名会在继承校验中拦截。
    await expect(f.commit(skillPlan.planId)).rejects.toMatchObject({code:'VALIDATION'});
    await expect(f.preview(skill.resourceId,{targetParentId:'.cbim/team/developer',slug:'duplicate'})).rejects.toMatchObject({code:'RESOURCE_PACKAGE'});
  }finally{await f.cleanup()}
});

it('单 Skill 可以导入空 Team；相同 slug 与目标目录大小写冲突不覆盖',async()=>{
  const f=await setup();try{
    const published=await f.publish('skill',f.team.shared),plan=await f.preview(published.resourceId,{slug:'review'});expect(plan.validation.structural).toBe(true);await f.commit(plan.planId);
    const snap=await f.target.snapshot();expect(JSON.parse(snap.files.find(file=>file.path==='.cbim/team/skills.json')!.text).skills).toEqual([{name:'review',purpose:'验证',reference:'skills/review/SKILL.md'}]);
    await expect(f.preview(published.resourceId,{slug:'review'})).rejects.toMatchObject({code:'RESOURCE_PACKAGE'});
    const coding=await f.publish('skill',f.team.own);await fs.mkdir(path.join(f.b,'.cbim/team/skills/Unused'));await expect(f.preview(coding.resourceId,{slug:'unused'})).rejects.toMatchObject({code:'EXISTS'});
  }finally{await f.cleanup()}
});

it('完整业务架构包含全部模块和 Workflow；非空目标须显式整包替换且清理旧空目录/索引',async()=>{
  const f=await setup();try{
    await fs.mkdir(path.join(f.a,'source_code'));const snap=await f.source.snapshot(),file=snap.files.find(file=>file.path===f.team.input.moduleId+'/module.json')!,definition=JSON.parse(file.text);definition.sources=[{location:'source_code',scope:'源项目代码'}];
    definition.maintenance={bindingId:'old-binding',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'old-confirm',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    const overview=moduleFiles('game',[],definition.sources)[1];overview.text=overview.text.replace('## 子模块和 source 节点\n无','## 子模块和 source 节点\n### source_code\n源工程目录说明。');
    await f.source.commit(request(snap,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护者',team:'.cbim/team'}]})},{path:file.path,text:json(definition)},{path:overview.path,text:overview.text}]));
    const published=await f.publish('architecture'),pack=parseWorkspacePackage(published.repository.items[0].content);
    expect(pack.files.filter(file=>file.path.endsWith('/module.json'))).toHaveLength(2);expect(json(pack)).not.toContain('old-binding');expect(json(pack)).not.toContain('maintainerPersonIds');expect(json(pack)).not.toContain('source_code');expect(pack.files.some(file=>file.path.endsWith('/workflow.md'))).toBe(true);
    await expect(f.preview(published.resourceId,{targetParentId:'.cbim/workspace/game',slug:'partial'})).rejects.toMatchObject({code:'RESOURCE_PACKAGE'});
    const plan=await f.preview(published.resourceId);expect(plan.validation.structural).toBe(true);await f.commit(plan.planId);
    await expect(f.preview(published.resourceId)).rejects.toMatchObject({code:'RESOURCE_PACKAGE'});
    const targetSnap=await f.target.snapshot();await f.target.commit(request(targetSnap,moduleFiles('legacy').map(({path,text})=>({path,text}))));
    const replaceBusiness=await f.preview(published.resourceId,{mode:'replace'});expect(replaceBusiness.validation.structural).toBe(true);await f.commit(replaceBusiness.planId);await expect(fs.stat(path.join(f.b,'.cbim/workspace/legacy'))).rejects.toMatchObject({code:'ENOENT'});
    const teamPublished=await f.publish('team');await fs.mkdir(path.join(f.b,'.cbim/team/old_group'));const old=await f.target.snapshot();expect(old.validation!.indexes['.cbim/team/registry.json']).toContain('old_group');
    const replace=await f.preview(teamPublished.resourceId,{mode:'replace'});expect(replace.validation.structural).toBe(true);await f.commit(replace.planId);
    await expect(fs.stat(path.join(f.b,'.cbim/team/old_group'))).rejects.toMatchObject({code:'ENOENT'});
    const final=await f.target.snapshot();expect(final.validation!.structural).toBe(true);expect(final.validation!.issues.filter(issue=>issue.code==='index_stale')).toEqual([]);expect(final.files.find(file=>file.path==='.cbim/team/registry.json')!.text).not.toContain('old_group');
  }finally{await f.cleanup()}
});

it('源仓库或目标版本变化、旧实例、被改计划、旧单模块资源都不能写入',async()=>{
  const f=await setup();try{
    const published=await f.publish('team'),plan=await f.preview(published.resourceId,{slug:'one'}),before=await f.target.read(),repo=await f.app.resources.read();
    await f.app.resources.save({repositoryId:repo.repositoryId,revision:repo.revision,item:{kind:'module',name:'旧模块',summary:'',content:'# old'}});
    await expect(f.commit(plan.planId)).rejects.toMatchObject({code:'CONFLICT'});expect((await f.target.read()).revision).toBe(before.revision);
    const old=(await f.app.resources.read()).items.find(item=>item.kind==='module')!;await expect(f.preview(old.id)).rejects.toMatchObject({code:'RESOURCE_KIND'});
    const targetPlan=await f.preview(published.resourceId,{slug:'two'}),snapshot=await f.target.snapshot();await f.target.commit(request(snapshot,[{path:'.cbim/team/README.md',text:'# 目标已修改'}]));
    await expect(f.commit(targetPlan.planId)).rejects.toMatchObject({code:'CONFLICT'});
    const fresh=await f.preview(published.resourceId,{slug:'three'});await expect(f.service().commit({workspaceId:f.target.entry.id,instanceId:'11111111-1111-4111-8111-111111111111',planId:fresh.planId})).rejects.toThrow();
    const file=path.join(f.target.paths.local(f.target.entry.id,'cache'),'resource-imports',fresh.planId+'.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.request.changes[0].text='# altered';await fs.writeFile(file,json(saved));await expect(f.commit(fresh.planId)).rejects.toMatchObject({code:'PLAN'});
  }finally{await f.cleanup()}
});

it('提交后回执保存中断可恢复原知识事务，并且未知资源阻止整体删除',async()=>{
  const f=await setup();try{
    const published=await f.publish('team'),plan=await f.preview(published.resourceId,{slug:'restored'}),service=f.service();
    const save=vi.spyOn(service as any,'savePlan').mockRejectedValueOnce(new Error('模拟回执缓存失败'));
    await expect(service.commit({workspaceId:f.target.entry.id,instanceId:f.target.instanceId,planId:plan.planId})).rejects.toMatchObject({code:'RESOURCE_IMPORT_APPLIED',message:expect.stringContaining('静态定义已应用')});save.mockRestore();
    const result=await f.commit(plan.planId);expect(result.state).toBe('committed');expect(await f.commit(plan.planId)).toEqual(result);
    await fs.writeFile(path.join(f.b,'.cbim/team/unknown.bin'),'不能删除');await expect(f.preview(published.resourceId,{mode:'replace'})).rejects.toMatchObject({code:'OBJECT_ASSETS'});expect(await fs.readFile(path.join(f.b,'.cbim/team/unknown.bin'),'utf8')).toBe('不能删除');
  }finally{await f.cleanup()}
});

it('替换保留旧花名册且忽略其团队引用；清理失败仍明确报告已应用并允许同计划续办',async()=>{
  const f=await setup();try{
    await fs.mkdir(path.join(f.b,'.cbim/team/legacy_group'));const snap=await f.target.snapshot();await f.target.commit(request(snap,[{path:'.cbim/team/people.json',text:json({people:[{id:'target_owner',name:'保留人员',team:'.cbim/team/legacy_group'}]})}]));
    const published=await f.publish('team');
    const plan=await f.preview(published.resourceId,{mode:'replace'}),prune=vi.spyOn(f.target.objects,'pruneEmpty').mockRejectedValueOnce(new Error('目录临时占用'));
    await expect(f.commit(plan.planId)).rejects.toMatchObject({code:'RESOURCE_IMPORT_APPLIED',message:expect.stringContaining('重试同一计划')});prune.mockRestore();
    expect((await f.target.read()).files.some(file=>file.path==='.cbim/team/dev/agent.json')).toBe(true);
    const result=await f.commit(plan.planId);expect(await f.commit(plan.planId)).toEqual(result);const final=await f.target.snapshot();expect(final.validation!.issues.filter(issue=>issue.code==='index_stale')).toEqual([]);expect(final.files.find(file=>file.path==='.cbim/team/people.json')!.text).toContain('保留人员');
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('包校验拒绝穿越、孤儿模块、未归属正文、隐藏配置、凭据和损坏指纹',async()=>{
  const f=await setup();try{
    const snapshot=await f.source.snapshot(),agent=buildWorkspacePackage(snapshot,{kind:'agent',objectId:f.team.input.agentId,name:'agent',summary:''}).package;
    const reject=(change:(pack:WorkspacePackage)=>void,base=agent)=>{const pack=structuredClone(base);change(pack);pack.fingerprint=workspacePackageFingerprint(pack);expect(()=>parseWorkspacePackage(json(pack))).toThrow(expect.objectContaining({code:'RESOURCE_PACKAGE'}))};
    reject(pack=>{pack.files[0].path='agent/../outside.md'});reject(pack=>{pack.files.push({path:'agent/hidden.md',text:'无归属正文'})});reject(pack=>{pack.files.push({path:'agent/config.json',text:'{}'})});reject(pack=>{pack.files.push({...pack.files[0],path:pack.files[0].path.toUpperCase()})});reject(pack=>{pack.files.find(file=>file.path==='agent/principles.md')!.text+='\n[外部](../../outside.md)'});reject(pack=>{pack.files.find(file=>file.path==='agent/principles.md')!.text+='\nsk-0123456789abcdefghijk'});
    const architecture=buildWorkspacePackage(snapshot,{kind:'architecture',name:'all',summary:''}).package;reject(pack=>{pack.files=pack.files.filter(file=>!['workspace/game/module.json','workspace/game/module.md','workspace/game/workflows/build/workflow.md'].includes(file.path))},architecture);
    expect(()=>parseWorkspacePackage(json({...agent,fingerprint:'0'.repeat(64)}))).toThrow(expect.objectContaining({code:'RESOURCE_PACKAGE'}));
  }finally{await f.cleanup()}
});
