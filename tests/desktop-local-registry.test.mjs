import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startRegistry} from '../services/resource-registry/src-server/registry.mjs';
import {localRegistry} from '../src/logic/resource-management/local-registry';
it('desktop publisher and read-only desktop pull exact selected bytes from local registry',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-registry-'));
  const token=crypto.randomUUID(),server=await startRegistry({data:path.join(dir,'server'),token});
  try{
    const port=new URL(server.url).port,a=localRegistry(path.join(dir,'a'),port,token),b=localRegistry(path.join(dir,'b'),port);
    const file=path.join(dir,'template.json'),key={kind:'talent',id:'planner',version:'1.0.0'};
    await fs.writeFile(file,'first');
    const first=await a.Publish(key,file);
    expect(await b.List()).toEqual([first]);
    await expect(b.Publish(key,file)).rejects.toThrow('REGISTRY_TOKEN');
    await fs.writeFile(file,'second');await a.Publish({...key,version:'2.0.0'},file);
    expect(await fs.readFile(await b.Pull(first),'utf8')).toBe('first');
    await expect(b.Pull({...first,sha256:'0'.repeat(64)})).rejects.toThrow('已变化');
  }finally{await server.close();await fs.rm(dir,{recursive:true,force:true});}
});

it('engine manager downloads a signed release, upgrades and uninstalls without unpublishing',async()=>{
  const {runtimeFixture}=await import('./src/logic/updates/service/support/runtime-fixture');
  const {EngineArtifacts}=await import('../src/logic/updates/service/engine-artifacts');
  const {EnginePackages}=await import('../src/resource/engines');
  const {RuntimeStore}=await import('../src/logic/updates/service/runtime-store');
  const {DownloadService}=await import('../src/logic/updates/service/download-service');
  const {archiveDirectory}=await import('../scripts/runtime-packaging');
  const f=await runtimeFixture(),data=path.join(f.root,'registry'),token=crypto.randomUUID(),server=await startRegistry({data,token});
  const prev=process.env.CBIM_REGISTRY_PORT,port=new URL(server.url).port;process.env.CBIM_REGISTRY_PORT=port;
  try{
    const client=localRegistry(f.root,port,token),signal=new AbortController().signal;
    const artifacts=new EngineArtifacts(path.join(f.root,'index.json'),new RuntimeStore(path.join(f.root,'store'),f.cold,new DownloadService(path.join(f.root,'dl'),signal)),undefined,signal);
    const engines=new EnginePackages(path.join(f.root,'state.json'),artifacts);
    for(const sequence of [1,2]){
      const dir=path.join(f.root,'engine'),version='1.0.'+sequence;await fs.writeFile(path.join(dir,'adapter.cjs'),'// adapter '+sequence);
      const pkg=await archiveDirectory(dir,f.output,'runtime-engines','pi-'+sequence);
      const release={...f.manifest.engines[0],package:pkg,adapter:{version,entry:'adapter.cjs',protocol:1}};
      await client.Publish({kind:'engine',id:'pi',version},path.join(f.output,pkg.name));
      const index={schema:1,sequence,createdAt:f.manifest.createdAt,expiresAt:f.manifest.expiresAt,sourceCommit:f.manifest.sourceCommit,notes:'test',platform:'win32-x64',releases:[release],current:[{kind:'pi',identity:pkg.sha256}]};
      await fs.writeFile(path.join(data,'signed-engine-index.json'),JSON.stringify(f.envelope(index)));
      await engines.Check();await engines.Install('pi');
      expect((await engines.ResolveEngine('pi')).identity).toBe(pkg.sha256);
    }
    await engines.SetEnabled('pi',false,true);
    await expect(engines.ResolveEngine('pi')).rejects.toThrow();
    expect(await client.List()).toHaveLength(2);
  }finally{if(prev===undefined)delete process.env.CBIM_REGISTRY_PORT;else process.env.CBIM_REGISTRY_PORT=prev;await server.close();await f.cleanup();}
});

it('all four market categories publish and fetch distinct versions with the same resource ID',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'market-categories-')),token=crypto.randomUUID();
  const server=await startRegistry({data:path.join(root,'server'),token});
  try{
    const port=new URL(server.url).port,client=localRegistry(path.join(root,'cache'),port,token);
    for(const kind of ['engine','connector','talent','business']){
      const file=path.join(root,kind);await fs.writeFile(file,kind);
      await client.Publish({kind,id:'sample',version:'1.0.0'},file);
    }
    const list=await client.List();expect(list).toHaveLength(4);
    for(const row of list)expect(await fs.readFile(await client.Pull(row),'utf8')).toBe(row.kind);
  }finally{await server.close();await fs.rm(root,{recursive:true,force:true});}
});

it('imports verified talent and business templates into independent persistent project nodes',async()=>{
  const {ProjectList}=await import('../src/logic/projects/project');
  const {Paths}=await import('../src/logic/projects/paths');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'market-project-')),token=crypto.randomUUID();
  const server=await startRegistry({data:path.join(root,'registry'),token});
  const paths=new Paths(root),projects=new ProjectList(paths);
  try{
    const client=localRegistry(path.join(root,'cache'),new URL(server.url).port,token);
    const dirs=[path.join(root,'A'),path.join(root,'B')];await Promise.all(dirs.map(dir=>fs.mkdir(dir)));
    const [a,b]=await Promise.all(dirs.map(dir=>projects.Add(dir)));
    for(const [kind,body] of [['talent',{kind:'team',name:'Market review',position:'review'}],['business',{parentId:null,name:'Market delivery',summary:'deliver',virtual:false,sources:[]}]]){
      const file=path.join(root,kind+'.json');await fs.writeFile(file,JSON.stringify(body));
      const row=await client.Publish({kind,id:'test',version:'1.0.0'},file);
      for(const project of [a,b])await projects.MarketTemplate(project.id,kind,row,await client.ReadTemplate(row),'import');
    }
    const reopened=new ProjectList(paths);
    try{
      for(const [directory,name] of [[reopened.settings.organization,'Market review'],[reopened.businessDirectory,'Market delivery']]){
        const left=(await directory.Read(a.id)).nodes.find(v=>v.name===name);
        const right=(await directory.Read(b.id)).nodes.find(v=>v.name===name);
        expect(left).toBeDefined();expect(right).toBeDefined();expect(left.id).not.toBe(right.id);
      }
    }finally{await reopened.Close();}
  }finally{await projects.Close();await server.close();await fs.rm(root,{recursive:true,force:true});}
});

it.each(['business','talent'])('merges chosen fields of a single %s subtree atomically and persists its source',async kind=>{
 const {ProjectList}=await import('../src/logic/projects/project'),{Paths}=await import('../src/logic/projects/paths');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'market-subtree-')),paths=new Paths(root),projects=new ProjectList(paths);
 try{
  const repo=path.join(root,'repo');await fs.mkdir(repo);const p=(await projects.Add(repo)).id;
  const make=(key,parent,name)=>kind==='talent'?{key,parent,name,kind:parent?'agent':'team',position:'old',skills:parent?[{id:'check',name:'Review',content:'old skill'}]:[]}:{key,parent,name,summary:'old',sources:[],virtual:false};
  const pack={nodes:[make('root',null,'Group'),make('child','root','Local')]},v1={id:'audit',version:'1.0.0',sha256:'1'.repeat(64)},v2={...v1,version:'2.0.0',sha256:'2'.repeat(64)};
  for(let i=0;i<2;i++)await projects.MarketTemplate(p,kind,v1,pack,'import');
  const directory=kind==='talent'?projects.settings.organization:projects.businessDirectory;
  const originals=await directory.Read(p),first=originals.nodes.find(n=>n.market?.key==='child'),instance=first.market.instance;
  const next=structuredClone(pack);next.nodes[1].name='Upstream name';
  if(kind==='talent')next.nodes[1].skills[0].content='new skill';else next.nodes[1].summary='new summary';
  if(kind==='talent'){
    await directory.Change(p,{action:'update',revision:originals.revision,id:first.id,name:'Edited locally',position:first.position,parentId:first.parentId});
    const settings=await projects.settings.Read(p,{kind:'member',id:first.id});
    await projects.settings.Save(p,{kind:'member',id:first.id},settings.revision,{...settings.configuration,skills:[...settings.configuration.skills,{id:'mine',name:'Local skill',content:'preserve'}]});
  }else{
    await directory.Change(p,{action:'update',revision:originals.revision,id:first.id,definition:{name:'Edited locally',parentId:first.parentId,summary:first.summary,sources:first.sources,virtual:first.virtual}});
  }
  const choice={instance,revision:(await directory.Read(p)).revision,fields:[]};
  const preview=await projects.MarketTemplate(p,kind,v2,next,'preview',choice);
  const field=preview.changes.find(c=>c.label.includes(kind==='talent'?'skill:check':'summary'));
  await projects.MarketTemplate(p,kind,v2,next,'merge',{...choice,fields:[field.id]});
  const saved=await directory.Read(p),node=saved.nodes.find(x=>x.id===first.id);
  expect(node.name).toBe('Edited locally');expect(node.market.version).toBe('2.0.0');
  expect(kind==='talent'?node.configuration.skills.find(s=>s.id==='check').content:node.summary).toBe(kind==='talent'?'new skill':'new summary');
  if(kind==='talent')expect(node.configuration.skills.find(s=>s.id==='mine').content).toBe('preserve');
  expect(saved.nodes.find(n=>n.market?.key==='child'&&n.market.instance!==instance).market.version).toBe('1.0.0');
  await expect(projects.MarketTemplate(p,kind,v2,next,'merge',{...choice,fields:[field.id]})).rejects.toThrow();
  const broken={nodes:[...next.nodes,make('orphan','missing','Bad')]};
  await expect(projects.MarketTemplate(p,kind,v2,broken,'import')).rejects.toThrow();
  expect(await directory.Read(p)).toEqual(saved);
  const reopened=new ProjectList(paths);
  try{expect((await (kind==='talent'?reopened.settings.organization:reopened.businessDirectory).Read(p)).nodes.find(x=>x.id===first.id).market).toEqual(node.market)}finally{await reopened.Close()}
 }finally{await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});
