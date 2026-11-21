import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectList } from '../../../../src/logic/projects/project';
import { Paths } from '../../../../src/logic/projects/paths';
import { ProjectOffices, type OfficeChat } from '../../../../src/logic/projects/offices';
import { OfficeQueue } from '../../../../src/logic/projects/office-queue';

test('空闲时优先执行选中项，失败保留记录且不阻塞其余指令',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-queue-'));const projects=new ProjectList(new Paths(root));const seen:string[]=[];
 const offices=new ProjectOffices(projects,async(_role,messages)=>{const goal=JSON.parse(messages.at(-1)!.content).userRequest;seen.push(goal);if(goal==='priority')throw Error('fixture failure');return {text:'ok',metrics:{elapsed:1,model:'m',capacity:1000}}});const queue=new OfficeQueue(projects,offices);
 try{await fs.mkdir(path.join(root,'repo'));const project=await projects.Add(path.join(root,'repo'));const session=await offices.Open(project.id,'create');await queue.Change(project.id,session.id,{action:'pause'});
 for(const text of ['first','priority','last'])await queue.Change(project.id,session.id,{action:'enqueue',id:crypto.randomUUID(),text,permission:'read',selection:{engine:'pi',profileId:'p',modelId:'m'}});
 const state=await queue.Read(project.id,session.id);await queue.Change(project.id,session.id,{action:'start',id:state.items[1].id,revision:state.revision});await expect.poll(async()=>(await queue.Read(project.id,session.id)).items.map(item=>item.status)).toEqual(['failed']);expect(seen).toEqual(['priority','first','last']);}
 finally{await queue.Close();await fs.rm(root,{recursive:true,force:true})}
});

test('宿主 FIFO、配置提交快照、重排、立即插入和提交去重共用同一 Office',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-queue-'));const projects=new ProjectList(new Paths(root));
 const calls:Array<{text:string;config:any;release:()=>void;inserted:string[];instance?:string}>=[];
 const chat:OfficeChat=async(_role,messages,signal,_progress,turn)=>{let release!:()=>void;const wait=new Promise<void>((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});});const row={text:JSON.parse(messages.at(-1)!.content).userRequest,config:structuredClone(turn.configuration),release,inserted:[] as string[],instance:turn.agentInstanceId};calls.push(row);const disconnect=turn.inputs!.Connect(async text=>{row.inserted.push(JSON.parse(text).officeInput.text);});try{await wait;}finally{await disconnect();}return{text:'完成'+row.text,metrics:{elapsed:1,model:turn.selection.modelId,capacity:1000}};};
 const offices=new ProjectOffices(projects,chat);const queue=new OfficeQueue(projects,offices);
 try{
  await fs.mkdir(path.join(root,'repo'));const project=await projects.Add(path.join(root,'repo'));const session=await offices.Open(project.id,'create');
  const enqueue=(id:string,text:string,model:string)=>queue.Change(project.id,session.id,{action:'enqueue',id,text,permission:'execute',selection:{engine:model==='m1'?'pi':'codex',profileId:'profile',modelId:model}});
  const first=crypto.randomUUID();await enqueue(first,'first','m1');await expect.poll(()=>calls.length).toBe(1);
  let settings=await offices.settings.Read(project.id,{kind:'main',id:session.id});await offices.settings.Save(project.id,{kind:'main',id:session.id},settings.revision,{...settings.configuration,connectorIds:['alpha']});
  const second=crypto.randomUUID();await enqueue(second,'second','m2');settings=await offices.settings.Read(project.id,{kind:'main',id:session.id});await offices.settings.Save(project.id,{kind:'main',id:session.id},settings.revision,{...settings.configuration,connectorIds:['beta']});
  const third=crypto.randomUUID();let state=await enqueue(third,'third','m3');
  expect(calls).lengthOf(1);expect(calls[0].config.model.modelId).toBe('m1');expect(calls[0].config.connectorIds).toEqual([]);
  expect(state.items.find(item=>item.id===second)?.configuration).toMatchObject({model:{modelId:'m2'},connectorIds:['alpha']});
  state=await queue.Change(project.id,session.id,{action:'move',revision:state.revision,id:third,beforeId:second});expect(state.items.map(item=>item.text)).toEqual(['first','third','second']);
  await expect(queue.Change(project.id,session.id,{action:'remove',revision:0,id:third})).rejects.toThrow('队列已变化');
  state=await queue.Change(project.id,session.id,{action:'insert',revision:state.revision,id:second});await expect.poll(()=>calls[0].inserted.length).toBe(1);expect(calls[0].inserted).toEqual(['second']);expect(state.items.find(item=>item.id===second)?.status).toBe('inserted');
  settings=await offices.settings.Read(project.id,{kind:'main',id:session.id});await offices.settings.Save(project.id,{kind:'main',id:session.id},settings.revision,{...settings.configuration,connectorIds:['gamma'],model:{engine:'pi',profileId:'profile',modelId:'later'}});
  calls[0].release();await expect.poll(()=>calls.length).toBe(2);expect(calls[1].text).toBe('third');expect(calls[1].config).toMatchObject({model:{engine:'codex',modelId:'m3'},connectorIds:['beta']});
  calls[1].release();await expect.poll(async()=>(await queue.Read(project.id,session.id)).items.length).toBe(0);
  await enqueue(first,'first','m1');await new Promise(resolve=>setTimeout(resolve,10));expect(calls).lengthOf(2);
 }finally{for(const row of calls)row.release();await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('停止暂停队列，未开始项保留；继续不自动重试失败项，明确移除后才推进',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-queue-stop-'));const projects=new ProjectList(new Paths(root));const started:string[]=[];
 const offices=new ProjectOffices(projects,async(_role,messages,signal)=>{const text=JSON.parse(messages.at(-1)!.content).userRequest;started.push(text);if(text==='first')await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));return{text,metrics:{elapsed:1,model:'m',capacity:1000}};});const queue=new OfficeQueue(projects,offices);
 try{await fs.mkdir(path.join(root,'repo'));const p=await projects.Add(path.join(root,'repo'));const s=await offices.Open(p.id,'create');const send=(text:string)=>queue.Change(p.id,s.id,{action:'enqueue',id:crypto.randomUUID(),text,permission:'read',selection:{engine:'pi',profileId:'p',modelId:'m'}});await send('first');await expect.poll(()=>started.length).toBe(1);await send('second');await queue.Change(p.id,s.id,{action:'stop'});await expect.poll(async()=>(await queue.Read(p.id,s.id)).items[0]?.status).toBe('failed');let state=await queue.Read(p.id,s.id);expect(state.items[0].cancelSource).toBe('user-stop');expect(state.paused).toBe(true);expect(started).toEqual(['first']);state=await queue.Change(p.id,s.id,{action:'remove',revision:state.revision,id:state.items[0].id});expect(state.items[0].text).toBe('second');await queue.Change(p.id,s.id,{action:'resume'});await expect.poll(async()=>(await queue.Read(p.id,s.id)).items.length).toBe(0);expect(started).toEqual(['first','second']);}
 finally{await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('重开保留顺序和配置，运行标记恢复为未确认且不自动重发，坏文件拒绝覆盖',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-queue-recover-'));const paths=new Paths(root);const projects=new ProjectList(paths);let runs=0;const offices=new ProjectOffices(projects,async()=>{runs++;return{text:'done',metrics:{elapsed:1,model:'m',capacity:1000}};});let queue=new OfficeQueue(projects,offices);
 try{await fs.mkdir(path.join(root,'repo'));const p=await projects.Add(path.join(root,'repo'));const s=await offices.Open(p.id,'create');await queue.Change(p.id,s.id,{action:'pause'});let state=await queue.Change(p.id,s.id,{action:'enqueue',id:crypto.randomUUID(),text:'waiting',permission:'ask',selection:{engine:'pi',profileId:'p',modelId:'m'}});await expect(queue.Change(p.id,s.id,{action:'insert',revision:state.revision,id:state.items[0].id})).rejects.toThrow('没有执行中的任务');expect((await queue.Read(p.id,s.id)).items[0].status).toBe('queued');await queue.Close();queue=new OfficeQueue(projects,offices);state=await queue.Read(p.id,s.id);expect(state.paused).toBe(true);expect(state.items[0].text).toBe('waiting');expect(runs).toBe(0);await queue.Close();const file=path.join(paths.Project(p.id),'office-queues',s.id+'.json');const stored=JSON.parse(await fs.readFile(file,'utf8'));stored.items[0].status='running';await fs.writeFile(file,JSON.stringify(stored));queue=new OfficeQueue(projects,offices);state=await queue.Read(p.id,s.id);expect(state.items[0].status).toBe('uncertain');await queue.Change(p.id,s.id,{action:'resume'});await new Promise(resolve=>setTimeout(resolve,10));expect(runs).toBe(0);await queue.Close();await fs.writeFile(file,'broken');queue=new OfficeQueue(projects,offices);await expect(queue.Read(p.id,s.id)).rejects.toThrow();await expect(queue.Change(p.id,s.id,{action:'resume'})).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe('broken');}
 finally{await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('slash 技能只在提交后加载选定正文，排队期间设置变化不替换已采纳技能',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-skill-'));const projects=new ProjectList(new Paths(root));const calls:any[]=[];
 const offices=new ProjectOffices(projects,async(prompt,messages)=>{calls.push({prompt,goal:JSON.parse(messages.at(-1)!.content)});return{text:'完成',metrics:{elapsed:1,model:'m',capacity:1000}};});const queue=new OfficeQueue(projects,offices);
 try{await fs.mkdir(path.join(root,'repo'));const p=await projects.Add(path.join(root,'repo'));const session=await offices.Open(p.id,'create');let saved=await offices.settings.Read(p.id,{kind:'main',id:session.id});await offices.settings.Save(p.id,{kind:'main',id:session.id},saved.revision,{...saved.configuration,skills:[{id:'a',name:'审核',content:'FROZEN_REVIEW'},{id:'b',name:'发布',content:'NEVER_AUTO_PUBLISH'}]});expect(calls).toHaveLength(0);await queue.Change(p.id,session.id,{action:'pause'});await queue.Change(p.id,session.id,{action:'enqueue',id:crypto.randomUUID(),text:'/skill:审核 检查代码',permission:'read',selection:{engine:'pi',profileId:'p',modelId:'m'}});saved=await offices.settings.Read(p.id,{kind:'main',id:session.id});await offices.settings.Save(p.id,{kind:'main',id:session.id},saved.revision,{...saved.configuration,skills:[]});await queue.Change(p.id,session.id,{action:'resume'});await expect.poll(()=>calls.length).toBe(1);expect(calls[0].prompt).not.toContain('FROZEN_REVIEW');expect(calls[0].prompt).not.toContain('NEVER_AUTO_PUBLISH');const request=JSON.parse(calls[0].goal.userRequest);expect(request.requestedSkills).toEqual([{id:'a',name:'审核',content:'FROZEN_REVIEW'}]);expect(request.userRequest).toBe('检查代码');await expect.poll(async()=>(await queue.Read(p.id,session.id)).items.length).toBe(0);const history=await offices.Open(p.id,'select',session.id);expect(history.messages.find(m=>m.role==='user')?.text).toBe('/skill:审核 检查代码');}
 finally{await queue.Close();await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});
