import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectList } from '../../../../src/logic/projects/project';
import { Paths } from '../../../../src/logic/projects/paths';
import { ProjectOffices, type OfficeChat } from '../../../../src/logic/projects/offices';
import { OfficeInputs } from '../../../../src/logic/projects/office-inputs';
import { ArchitectureUpdate } from '../../../../src/logic/projects/architecture-update';

test('差异包含新旧父节点、祖先、删除墓碑和根层变化', () => {
  const before = [{id:'a',parentId:null},{id:'b',parentId:null},{id:'c',parentId:'a'},{id:'d',parentId:'c'}];
  const moved = before.map(node=>node.id==='c'?{...node,parentId:'b'}:node);
  const event=JSON.parse(ArchitectureUpdate.Describe('organization',2,before,moved));
  expect(event.nodes.map((node:any)=>node.id).sort()).toEqual(['a','b','c']);
  expect(event.nodes.find((node:any)=>node.id==='a').children).toEqual([]);
  expect(event.nodes.find((node:any)=>node.id==='b').children).toEqual(['c']);
  const removed=JSON.parse(ArchitectureUpdate.Describe('business',3,moved,moved.filter(node=>node.id!=='d')));
  expect(removed.nodes.find((node:any)=>node.id==='d').deleted).toBe(true);
  expect(removed.nodes.map((node:any)=>node.id).sort()).toEqual(['b','c','d']);
});

test('运行摘要显示具体命令，更新保持计时，结束后回到等待模型',async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'office-live-action-'));
  const projects = new ProjectList(new Paths(root));
  const states: string[] = [];
  const seen: {actor:string;action:string;since:number}[] = [];
  const chat: OfficeChat = async (_role,_messages,_signal,emit) => {
    const activity = {id:'tool:git',label:'bash'};
    emit({phase:'thinking',model:'m',activity:{...activity,input:JSON.stringify({command:'cd project && git status'})}});
    emit({phase:'thinking',model:'m',activity,toolFinished:false});
    emit({phase:'thinking',model:'m',activity,toolFinished:true});
    return {text:'完成',metrics:{elapsed:1,model:'m',capacity:1000}};
  };
  try {
    const repo = path.join(root,'repo');
    await fs.mkdir(repo);
    const entry = await projects.Add(repo);
    const offices = new ProjectOffices(projects,chat);
    const session = await offices.Open(entry.id,'create');
    await offices.Send(entry.id,session.id,'检查仓库',sample=>{
      if (sample.activity?.toolState) states.push(sample.activity.toolState);
      if(sample.runningAction) seen.push({...sample.runningAction});
    },'execute',{engine:'pi',profileId:'p',modelId:'m'});
    expect(states).toEqual(['running','returned']);
    const commands = seen.filter(item=>item.action==='执行 git status');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0].actor).toBe('助理');
    expect(seen.at(-1)?.action).toBe('等待模型响应');
  } finally { await projects.Close(); await fs.rm(root,{recursive:true,force:true}); }
});

test('追加输入保序，原生交付未知不重发，终态领取与关闭无竞态',async()=>{
  const states:string[]=[];const inputs=new OfficeInputs((_id,_text,state)=>states.push(state));
  inputs.Push('one');inputs.Push('two');
  const delivered:string[]=[];
  const disconnect=inputs.Connect(async text=>{delivered.push(JSON.parse(text).officeInput.text);if(delivered.length===2)throw Error('unknown');});
  await new Promise(resolve=>setTimeout(resolve,0));await disconnect();
  expect(delivered).toEqual(['one','two']);expect(inputs.Take()).toEqual([]);expect(states.some(state=>state.includes('未确认'))).toBe(true);
  inputs.Push('three');expect(inputs.Finish().map(entry=>entry.text)).toEqual(['three']);
  inputs.Push('four');expect(inputs.Finish().map(entry=>entry.text)).toEqual(['four']);expect(inputs.Finish()).toEqual([]);
  expect(()=>inputs.Push('late')).toThrow('已结束');
});

test('项目内两个活跃 Office 都收到架构和父节点变化，其他项目隔离，实例继续运行',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'architecture-live-'));const projects=new ProjectList(new Paths(root));
 const gates=new Map<string,()=>void>();const received=new Map<string,any[]>();
 const chat:OfficeChat=async(_role,_messages,_signal,_progress,turn)=>{received.set(turn.session,[]);const disconnect=turn.inputs!.Connect(async text=>{received.get(turn.session)!.push(JSON.parse(text).officeInput);});await new Promise<void>(resolve=>gates.set(turn.session,resolve));await disconnect();turn.ReportTokens(5);return {text:'完成',metrics:{elapsed:1,model:'test',capacity:1000}};};
 const offices=new ProjectOffices(projects,chat);const selection={engine:'pi',profileId:'p',modelId:'m'};
 const runs:Promise<unknown>[]=[];
 try{
  await fs.mkdir(path.join(root,'a'));await fs.mkdir(path.join(root,'b'));const a=await projects.Add(path.join(root,'a')),b=await projects.Add(path.join(root,'b'));
  const sessions=[await offices.Open(a.id,'create'),await offices.Open(a.id,'create'),await offices.Open(b.id,'create')];
  for(const [i,session]of sessions.entries())runs.push(offices.Send(i<2?a.id:b.id,session.id,'开始',undefined,'execute',selection));
  await expect.poll(()=>gates.size).toBe(3);
  let org=await offices.settings.organization.Change(a.id,{action:'create',revision:0,kind:'team',parentId:null,name:'研发',position:''});const team=org.nodes[0].id;
  org=await offices.settings.organization.Change(a.id,{action:'create',revision:org.revision,kind:'agent',parentId:team,name:'工程师',position:'实现'});const member=org.nodes.at(-1)!.id;
  await offices.settings.Save(a.id,{kind:'member',id:member},0,{model:selection,skills:[],connectorIds:[]});
  const runtime=(await projects.Open(a.id)).runtime;
  expect(runtime.organization!.FindMember(member)?.available).toBe(true);
  let business=await offices.business.Change(a.id,{action:'create',revision:0,definition:{parentId:null,name:'订单',summary:'处理订单',sources:[],virtual:false}});const workspace=business.nodes[0].id;
  business=await offices.business.Change(a.id,{action:'update',revision:business.revision,id:workspace,definition:{parentId:null,name:'新订单',summary:'新职责',sources:[],virtual:false}});
  expect(runtime.project!.FindWorkspace(workspace)?.name).toBe('新订单');
  org=await offices.settings.organization.Change(a.id,{action:'delete',revision:org.revision,id:member});
  expect(runtime.organization!.FindMember(member)).toBeUndefined();
  expect(runtime.ListOffices().every(office=>office.ListActiveAgents().length===1)).toBe(true);
  const inserted=offices.Insert(a.id,sessions[0].id,'同时核对测试');expect(inserted.status).toBe('queued');
  await expect.poll(()=>received.get(sessions[0].id)!.length).toBe(7);
  expect(received.get(sessions[1].id)).lengthOf(6);expect(received.get(sessions[2].id)).toEqual([]);
  const memberCreated=JSON.parse(received.get(sessions[0].id)![1].text);expect(memberCreated.nodes.map((node:any)=>node.id)).toContain(team);
  for(const gate of gates.values())gate();
  const results=await Promise.all(runs);expect(results).lengthOf(3);
  const reopened=await offices.Open(a.id,'select',sessions[0].id);expect(reopened.messages.at(-1)?.workLog?.some(item=>item.input==='同时核对测试')).toBe(true);
  const restored=new ProjectOffices(projects,chat);expect(await restored.business.Read(a.id)).toEqual(business);
 }finally{for(const gate of gates.values())gate();await Promise.allSettled(runs);await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('无原生插入的宿主在同一主任务继续处理尾部变化，不等待用户再发送',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'architecture-tail-'));const projects=new ProjectList(new Paths(root));let release!:()=>void;const prompts:string[]=[];let calls=0;
 const chat:OfficeChat=async(_role,messages,_signal,_progress,turn)=>{prompts.push(messages.at(-1)!.content);if(++calls===1)await new Promise<void>(resolve=>release=resolve);turn.ReportTokens(10);return {text:'阶段'+calls,metrics:{elapsed:1,model:'test',capacity:1000,cost:1}};};
 const offices=new ProjectOffices(projects,chat);let run:Promise<any>|undefined;
 try{await fs.mkdir(path.join(root,'repo'));const entry=await projects.Add(path.join(root,'repo'));const session=await offices.Open(entry.id,'create');run=offices.Send(entry.id,session.id,'执行',undefined,'read',{engine:'codex',profileId:'p',modelId:'m'});await expect.poll(()=>calls).toBe(1);await offices.settings.organization.Change(entry.id,{action:'create',revision:0,kind:'team',parentId:null,name:'新团队',position:''});release();const result=await run;expect(calls).toBe(2);expect(prompts[1]).toContain('architecture.changed');expect(result.at(-1).text).toContain('阶段2');expect(result.at(-1).metrics.cost).toBe(2);const office=(await projects.Open(entry.id)).runtime.FindOffice(session.officeId)!;expect(office.ListAgents().find(agent=>agent.usage.totalTokens===20)).toBeTruthy();}
 finally{release?.();await run?.catch(()=>{});await projects.Close();await fs.rm(root,{recursive:true,force:true});}
});

test('助理引用终端回执向运行中的成员投递一次环境广播', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-broadcast-'));
  const projects = new ProjectList(new Paths(root));
  const selection = { engine: 'pi', profileId: 'p', modelId: 'm' };
  let memberId = '', workspaceId = '', ready!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  const received: string[] = [];
  const chat: OfficeChat = async (_role, _messages, signal, progress, turn) => {
    if (turn.operations.BroadcastEnvironment) {
      const pending = turn.operations.Dispatch({ memberId, workspaceId, directory: '.', goal: '验证' }, signal);
      try {
        await Promise.race([started, pending]);
        const notice = { evidenceId: 'unknown', finding: '探测命令缺失', scope: '当前终端' };
        expect(() => turn.operations.BroadcastEnvironment!(notice)).toThrow('回执');
        progress({ phase: 'thinking', model: 'm', toolFinished: true, activity: { id:'tool:probe', label:'bash', result:'command not found: probe', alert:'bash执行失败' } });
        const inspection = turn.operations.Inspect() as { environmentEvidence: { id: string }[] };
        notice.evidenceId = inspection.environmentEvidence[0].id;
        expect(turn.operations.BroadcastEnvironment!(notice)).toEqual({queuedFor:['成员']});
        expect(turn.operations.BroadcastEnvironment!(notice)).toEqual({queuedFor:[]});
        await expect.poll(() => received.length).toBe(1);
      } finally { finish(); await pending; }
    } else {
      const disconnect = turn.inputs!.Connect(async text => { received.push(JSON.parse(JSON.parse(text).officeInput.text).finding); });
      ready(); await release; await disconnect();
    }
    return { text:'完成', metrics:{elapsed:1,model:'m',capacity:1000} };
  };
  try {
    const repo = path.join(root,'repo');
    await fs.mkdir(repo);
    const { execFileSync } = await import('node:child_process');
    execFileSync('git',['-C',repo,'init','-q']);
    execFileSync('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=t@example.org','commit','--allow-empty','-qm','init']);
    const project = await projects.Add(repo);
    const offices = new ProjectOffices(projects,chat);
    const office = await offices.Open(project.id,'create');
    let org = await offices.settings.organization.Change(project.id,{action:'create',revision:0,kind:'team',parentId:null,name:'研发',position:''});
    org = await offices.settings.organization.Change(project.id,{action:'create',revision:org.revision,kind:'agent',parentId:org.nodes[0].id,name:'成员',position:'工程师'});
    memberId = org.nodes.at(-1)!.id;
    await offices.settings.Save(project.id,{kind:'member',id:memberId},0,{model:selection,skills:[],connectorIds:[]});
    workspaceId = (await offices.business.Change(project.id,{action:'create',revision:0,definition:{parentId:null,name:'开发',summary:'',sources:[],virtual:false}})).nodes[0].id;
    const messages = await offices.Send(project.id,office.id,'验证广播',undefined,'execute',selection);
    expect(received).toEqual(['探测命令缺失']);
    expect(messages.at(-1)?.workLog?.find(step=>step.label==='环境广播')).toMatchObject({recipient:'成员',summary:'探测命令缺失 · 引擎已接收追加输入'});
  } finally { finish(); await projects.Close(); await fs.rm(root,{recursive:true,force:true}); }
});
