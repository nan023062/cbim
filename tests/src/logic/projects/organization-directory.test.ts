import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectList} from '../../../../src/logic/projects/project';
import {Paths} from '../../../../src/logic/projects/paths';
import {AgentSettings} from '../../../../src/logic/projects/agent-settings';

test('组织 CRUD 保留成员能力，拒绝循环和过期写，删除不复活，重开后持久恢复',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'org-directory-'));
 const paths=new Paths(root);
 let projects=new ProjectList(paths);
 let settings=new AgentSettings(projects);
 try{
  const repo=path.join(root,'repo');await fs.mkdir(path.join(repo,'.cbim/team/engineering/writer'),{recursive:true});
  await fs.writeFile(path.join(repo,'.cbim/team/engineering/writer/agent.json'),JSON.stringify({name:'Writer',summary:'write'}));
  const entry=await projects.Add(repo);const directory=settings.organization;
  let snapshot=await directory.Read(entry.id);
  expect(snapshot.nodes.map(node=>node.kind)).toEqual(['team','agent']);
  const originalTeam=snapshot.nodes[0].id;const originalMember=snapshot.nodes[1].id;
  snapshot=await directory.Change(entry.id,{action:'create',revision:snapshot.revision,kind:'team',parentId:null,name:'Design',position:'design'});
  const team=snapshot.nodes.at(-1)!.id;
  await settings.Apply(entry.id);
  expect((await projects.Open(entry.id)).runtime.organization!.FindTeam(team)?.children).toEqual([]);
  await expect(directory.Change(entry.id,{action:'create',revision:0,kind:'agent',parentId:team,name:'Stale',position:''})).rejects.toThrow('已被其他操作更新');
  snapshot=await directory.Change(entry.id,{action:'create',revision:snapshot.revision,kind:'agent',parentId:team,name:'Artist',position:'draw'});
  const member=snapshot.nodes.at(-1)!.id;
  const configuration={model:{engine:'pi',profileId:'p',modelId:'m'},skills:[{id:'paint',name:'paint',content:'PAINT_ONLY'}],connectorIds:['world-clock']};
  await settings.Save(entry.id,{kind:'member',id:member},0,configuration);
  await expect(directory.Change(entry.id,{action:'delete',revision:snapshot.revision,id:team})).rejects.toThrow('非空团队');
  await expect(directory.Change(entry.id,{action:'update',revision:snapshot.revision,id:team,parentId:member,name:'Design',position:''})).rejects.toThrow('组织归属无效');
  await expect(directory.Change(entry.id,{action:'update',revision:snapshot.revision,id:team,parentId:team,name:'Design',position:''})).rejects.toThrow('循环');
  snapshot=await directory.Change(entry.id,{action:'update',revision:snapshot.revision,id:member,parentId:originalTeam,name:'Senior artist',position:'review art'});
  expect((await settings.Read(entry.id,{kind:'member',id:member})).configuration).toEqual(configuration);
  await settings.Apply(entry.id);
  expect((await projects.Open(entry.id)).runtime.organization!.FindMember(member)).toMatchObject({name:'Senior artist',position:'review art',available:true,...configuration});
  await expect(directory.Change(entry.id,{action:'create',revision:snapshot.revision,kind:'agent',parentId:originalTeam,name:'Senior artist',position:''})).rejects.toThrow('同名');
  const office=(await projects.Open(entry.id)).runtime.OpenOffice(entry.id,'test');
  await office.OpenMainAgent({parameters:null,CreateEngine:async()=>({session:{},Close:async()=>{}})});
  snapshot=await directory.Change(entry.id,{action:'delete',revision:snapshot.revision,id:team});
  expect((await projects.Open(entry.id)).runtime.organization!.FindTeam(team)).toBeUndefined();
  await office.CloseMainEngine();
  snapshot=await directory.Change(entry.id,{action:'delete',revision:snapshot.revision,id:originalMember});
  await settings.Apply(entry.id);
  expect((await projects.Open(entry.id)).runtime.organization!.FindMember(originalMember)).toBeUndefined();
  await expect(settings.Read(entry.id,{kind:'member',id:originalMember})).rejects.toThrow('不属于');
  await projects.Close();projects=new ProjectList(paths);settings=new AgentSettings(projects);
  expect(await settings.organization.Read(entry.id)).toEqual(snapshot);
  expect((await settings.Read(entry.id,{kind:'member',id:member})).configuration).toEqual(configuration);
  await settings.Apply(entry.id);
  expect((await projects.Open(entry.id)).runtime.organization!.FindMember(originalMember)).toBeUndefined();
  await fs.writeFile(path.join(repo,'.cbim/cability/organization.json'),'broken');
  await expect(settings.organization.Read(entry.id)).rejects.toThrow();
  await expect(settings.organization.Change(entry.id,{action:'delete',revision:snapshot.revision,id:team})).rejects.toThrow();
  expect(await fs.readFile(path.join(repo,'.cbim/cability/organization.json'),'utf8')).toBe('broken');
 }finally{await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});
test('旧用户快照迁入项目，复制项目后无需原用户目录即可恢复两棵树',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'portable-trees-'));
 const paths=new Paths(path.join(root,'user-a'));
 const a=new ProjectList(paths), b=new ProjectList(new Paths(path.join(root,'user-b')));
 try{
  await fs.mkdir(paths.userRoot);await fs.mkdir(path.join(root,'user-b'));const repo=path.join(root,'repo');await fs.mkdir(repo);
  const entry=await a.Add(repo);
  const org={revision:7,nodes:[{id:'team-1',kind:'team',name:'设计',parentId:null,position:''}]};
  const business={revision:8,nodes:[{id:'combat',name:'战斗',parentId:null,summary:'玩法',virtual:false,sources:[]}]};
  for(const [name,snapshot] of [['organization',org],['business',business]] as const)
    await fs.writeFile(path.join(paths.Project(entry.id),name+'.json'),JSON.stringify(snapshot));
  const project=await a.Open(entry.id);
  expect(await project.trees.Organization()).toEqual(org);
  expect(await project.trees.Business()).toEqual(business);
  const copy=path.join(root,'copy');await fs.cp(repo,copy,{recursive:true});
  const clone=await b.Open((await b.Add(copy)).id);
  expect(clone.runtime.organization.FindTeam('team-1')?.name).toBe('设计');
  expect(clone.runtime.business.FindWorkspace('combat')?.name).toBe('战斗');
  expect(await clone.trees.Business()).toEqual(business);
 }finally{await a.Close();await b.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('项目实例校验版本引用，串行处理并发修改并隔离不同项目',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-assets-'));
 const list=new ProjectList(new Paths(root));
 const context={session:crypto.randomUUID(),selection:{engine:'pi',profileId:'p',modelId:'m'}};
 try{
   const open=async(name:string)=>{const folder=path.join(root,name);await fs.mkdir(folder);return (await list.Open((await list.Add(folder)).id)).runtime;};
   const first=await open('one'),second=await open('two');
   const read=async()=>await first.ReadResource({resource:'references'}) as {revision:string};
   const change=(action:string,revision:string,digest?:string)=>first.ChangeResource({resource:'references',change:{action,kind:'engines',id:'pi',revision,digest}},context);
   const {revision}=await read();
   await expect(change('create',revision,'bad')).rejects.toThrow();
   const results=await Promise.allSettled(['a','b'].map(v=>change('create',revision,v.repeat(64))));
   expect(results.map(v=>v.status)).toEqual(['fulfilled','rejected']);
   expect(first.shared.Identity('engines','pi')).toBe('a'.repeat(64));
   expect(second.shared.Identity('engines','pi')).toBeUndefined();
   await change('update',(await read()).revision,'c'.repeat(64));
   await first.ChangeResource({resource:'references',change:{action:'delete',kind:'engines',id:'pi',revision:(await read()).revision}},context);
   expect(first.shared.Identity('engines','pi')).toBeUndefined();
   await first.Close();await expect(read()).rejects.toThrow('关闭');
 }finally{await list.Close();await fs.rm(root,{recursive:true,force:true});}
});
