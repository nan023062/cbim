import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectList } from '../../../../src/logic/projects/project';
import { Paths } from '../../../../src/logic/projects/paths';
import { ProjectOffices } from '../../../../src/logic/projects/offices';
import { OfficeQueue } from '../../../../src/logic/projects/office-queue';
import { ProjectNavigation } from '../../../../src/logic/projects/navigation';

test('导航独立加载所有项目历史、持久名称/置顶/排序/归档与恢复，不改变目录身份', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'navigation-'));const projects=new ProjectList(new Paths(root));const offices=new ProjectOffices(projects);const queue=new OfficeQueue(projects,offices);let navigation=new ProjectNavigation(projects,queue);
 try {await fs.mkdir(path.join(root,'one'));await fs.mkdir(path.join(root,'two'));const one=await projects.Add(path.join(root,'one'));const two=await projects.Add(path.join(root,'two'));let state=await navigation.Read();expect(state.projects.map(p=>p.sessions.length)).toEqual([0,0]);expect(projects.ListOffices()).lengthOf(0);
 const session=await offices.Open(one.id,'create');let revision=(await navigation.Read()).revision;const change=async(action:any,extra:any={})=>{const next=await navigation.Change({project:one.id,revision,action,...extra});revision=next.revision;return next;};
 state=await change('rename',{name:'重命名项目'});expect(state.projects[0]).toMatchObject({id:one.id,path:one.path,name:'重命名项目'});
 await change('rename',{session:session.id,name:'长期任务'});await change('pin',{session:session.id,value:true});await change('archive',{session:session.id});navigation=new ProjectNavigation(projects,queue);state=await navigation.Read();expect(state.projects[0].sessions[0]).toMatchObject({title:'长期任务',pinned:true,archived:true});
 state=await change('restore',{session:session.id});expect(state.projects[0].sessions[0].archived).toBe(false);state=await navigation.Change({revision,project:two.id,action:'move',before:one.id});revision=state.revision;expect(state.projects.map(p=>p.id)).toEqual([two.id,one.id]);
 state=await change('remove');expect(state.projects.find(p=>p.id===one.id)?.removed).toBe(true);expect((await projects.Read()).entries).lengthOf(2);expect(await fs.stat(one.path)).toBeTruthy();await change('restore');
 await expect(navigation.Change({revision:0,project:one.id,action:'rename',name:'冲突'})).rejects.toThrow('已变化');await expect(navigation.Change({revision,project:two.id,session:session.id,action:'remove'})).rejects.toThrow('不属于');
 const file=path.join(root,'navigation.json');await fs.writeFile(file,'invalid');await expect(navigation.Read()).rejects.toThrow();await expect(change('rename',{name:'不覆盖'})).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe('invalid');
 }finally{await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('运行状态跨页面可读，归档不停止；删除只停止目标 Office 并暂停队列，历史可恢复',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'navigation-running-'));const projects=new ProjectList(new Paths(root));const offices=new ProjectOffices(projects,async(_r,_m,signal)=>{await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));return{text:'done',metrics:{model:'m',elapsed:1,capacity:1}};});const queue=new OfficeQueue(projects,offices);const nav=new ProjectNavigation(projects,queue);
 try{await fs.mkdir(path.join(root,'repo'));const p=await projects.Add(path.join(root,'repo'));const a=await offices.Open(p.id,'create');const b=await offices.Open(p.id,'create');const send=(id:string)=>queue.Change(p.id,id,{action:'enqueue',id:crypto.randomUUID(),text:'执行',permission:'read',selection:{engine:'pi',profileId:'p',modelId:'m'}});await send(a.id);await send(b.id);await expect.poll(()=>offices.IsRunning(p.id,a.id)&&offices.IsRunning(p.id,b.id)).toBe(true);await send(a.id);let state=await nav.Read();expect(state.projects[0].sessions.find(s=>s.id===a.id)).toMatchObject({running:true,queued:1});state=await nav.Change({revision:state.revision,project:p.id,session:a.id,action:'archive'});expect(offices.IsRunning(p.id,a.id)).toBe(true);state=await nav.Change({revision:state.revision,project:p.id,session:a.id,action:'remove'});await expect.poll(()=>offices.IsRunning(p.id,a.id)).toBe(false);expect(offices.IsRunning(p.id,b.id)).toBe(true);expect((await queue.Read(p.id,a.id)).paused).toBe(true);expect(state.projects[0].sessions.find(s=>s.id===a.id)?.removed).toBe(true);state=await nav.Change({revision:state.revision,project:p.id,session:a.id,action:'restore'});expect(state.projects[0].sessions.find(s=>s.id===a.id)).toMatchObject({removed:false,archived:false});expect((await offices.Open(p.id,'select',a.id)).id).toBe(a.id);}
 finally{await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});
