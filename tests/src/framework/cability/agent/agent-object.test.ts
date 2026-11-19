import { Organization } from '../../../../../src/framework/cability/organization';
import { CbimRuntime } from '../../../../../src/framework/cbim-runtime';
import {it,expect,vi} from 'vitest';
import {Team} from '../../../../../src/framework/cability/team';
import {AgentRole,runAgentTask,type AgentTaskExecution} from '../../../../../src/framework/cability/agent';

it('Office 内置负责人绑定主会话，并在关闭时释放其引擎', async () => {
  const runtime = new CbimRuntime();
  const office = runtime.OpenOffice('project', 'one');
  const other = runtime.OpenOffice('project', 'two');
  expect(runtime.OpenOffice('project', 'one').mainAgentId).toBe(office.mainAgentId);
  expect(other.mainAgentId).not.toBe(office.mainAgentId);
  expect(office.FindAgent(office.mainAgentId)).toBeDefined();
  const close = vi.fn(async () => {});
  const factory = { parameters: 0, CreateEngine: async (_: number, id: string, role: AgentRole) => {
    expect(id).toBe(office.mainAgentId);
    expect(role.conversation).toEqual({ workspaceId: 'project', taskId: 'one' });
    expect(role.definition.position).toBe('Office 负责人、用户助手');
    return { session: 'engine', Close: close };
  } };
  expect(await office.OpenMainAgent(factory)).toBe('engine');
  await office.Close();
  await expect(office.OpenMainAgent(factory)).rejects.toThrow('办公室已关闭');
  expect(close).toHaveBeenCalledTimes(1);
  await runtime.Close();
});

it('freezes identity and model selection without copying conversation messages',()=>{
  const model={engine:'pi',profileId:'profile',modelId:'model'},definition={id:'agent',name:'Agent',instructions:'role',model},conversation={workspaceId:'workspace',taskId:'task'};
  const agent=new AgentRole(definition,conversation);definition.name='changed';conversation.taskId='other';model.modelId='changed';
  expect(agent.definition.name).toBe('Agent');expect(agent.conversation.taskId).toBe('task');expect(agent.definition.model?.modelId).toBe('model');expect(Object.isFrozen(agent.definition)).toBe(true);expect(Object.isFrozen(agent.definition.model)).toBe(true);
});

it('groups office positions by team and observes only the environment supplied for this call',async()=>{
  const model={engine:'pi',profileId:'p',modelId:'m'};
  const writer={kind:'agent' as const,id:'writer',agentId:'developer',name:'Writer',position:'implementation',available:true,model};
  const engineering=new Team('engineering',[writer]);
  const reviewer={...writer,id:'reviewer',agentId:'reviewer'};
  const organization=new Organization('company');
  organization.ReplaceChildren([engineering,reviewer]);
  expect(organization.children).toEqual([engineering,reviewer]);
  expect(organization.FindMember('writer')).toEqual(writer);
  expect(organization.FindMember('reviewer')).toEqual(reviewer);
  expect(organization.FindMember('developer')).toBeUndefined();
  expect(engineering.children).toEqual([writer]);
  expect(()=>new Team('empty',[])).toThrow('团队至少需要一个子节点');
  const role={id:'developer',name:'Writer',instructions:'',model};
  const environment={organization,modules:[{id:'editor',ownerMemberId:'writer'}]};
  const agent=new AgentRole(role,{workspaceId:'project',taskId:'child'},async()=>environment);
  expect(await agent.Observe?.()).toEqual(environment);
});

it('waits for forwarded output before summarizing local and remote work',async()=>{
  const events:string[]=[];
  const agent=new AgentRole({id:'a',name:'A',instructions:''},{workspaceId:'w',taskId:'t'},async()=>{
    events.push('observe');return {modules:[]};
  });
  const execution:AgentTaskExecution={
    Analyze:async()=>{events.push('analyze');return 'analysis'},
    Decompose:async(_,environment)=>{expect(environment?.modules).toEqual([]);events.push('decompose');return [{kind:'local',task:'one'},{kind:'forward',memberId:'b',task:'two'}]},
    Execute:async()=>{events.push('execute');return 'one'},
    Summarize:async(_,__,results)=>{events.push('summarize');return results.map(r=>r.output).join('+')}
  };
  let finish!:(output:string)=>void;
  const reply=new Promise<string>(resolve=>{finish=resolve});
  let started!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve});
  const running=runAgentTask(agent,'task',execution,{Forward:async()=>{events.push('forward');started();return reply}});
  await waiting;
  expect(events).toEqual(['analyze','observe','decompose','execute','forward']);
  finish('two');
  expect(await running).toMatchObject({status:'completed',conclusion:'one+two'});
  expect(events.at(-1)).toBe('summarize');
  const blocked=await runAgentTask(agent,'task',execution);
  expect(blocked).toMatchObject({status:'blocked',remaining:[{memberId:'b'}],results:[{output:'one'}]});
  expect(events.at(-1)).toBe('execute');
});

it('同一任务使用各岗位自己的职责和已采纳技能',async()=>{
  const execution:AgentTaskExecution={
    Analyze:async(_,task)=>task,
    Decompose:async(_,__,role)=>[{kind:'local',task:role.position!,skillIds:['inspect']}],
    Execute:async(step,_,__,skills)=>step.task+' / '+skills[0].content,
    Summarize:async(_,__,results)=>results[0].output
  };
  for(const [position,content] of [['审校','核对文中引用'],['测试','运行回归用例']]){
    const definition={id:position,name:position,instructions:'',position,effectiveSkills:[{skillId:'inspect',ownerId:position,inherited:false,content}]};
    const agent=new AgentRole(definition,{workspaceId:'w',taskId:'t'});
    expect(await runAgentTask(agent,'检查交付',execution)).toMatchObject({conclusion:position+' / '+content});
    await expect(runAgentTask(agent,'检查交付',{...execution,Decompose:async()=>[{kind:'local',task:'check',skillIds:['other']}]})).rejects.toThrow('当前岗位没有采用该技能');
  }
});

it('reserves the agent during startup and retries a failed engine release', async () => {
  const service = new Organization();
  const role = new AgentRole({ id: 'writer', name: 'Writer', instructions: '' }, { workspaceId: 'w', taskId: 'task' });
  let attempts = 0;
  const engine = {};
  const opening = service.CreateAndStart('run', role, { parameters: engine, CreateEngine: async session => ({ session, Close: async () => { if (++attempts === 1) throw Error('still running'); } }) });
  await expect(service.CreateAndStart('run', role, { parameters: undefined, CreateEngine: async () => { throw Error('unexpected open'); } })).rejects.toThrow('已登记');
  expect((await opening).engine).toBe(engine);
  const closing = service.Destroy('run');
  expect(service.Destroy('run')).toBe(closing);
  await expect(closing).rejects.toThrow('still running');
  await service.Destroy('run');
  await service.Destroy('run');
  expect(attempts).toBe(2);
});
it('同一个 Organization 并行管理不同引擎类型', async () => {
  const service = new Organization();
  const role = new AgentRole({ id: 'worker', name: 'Worker', instructions: '' }, { workspaceId: 'w', taskId: 'task' });
  const closed: string[] = [];
  const [text, counter] = await Promise.all([
    service.CreateAndStart('text', role, { parameters: 'ok', CreateEngine: async (text, id, selectedRole) => { expect(id).toBe('text'); expect(selectedRole).toBe(role); return { session: { read: () => text }, Close: async () => { closed.push(id); } }; } }),
    service.CreateAndStart('counter', role, { parameters: 3, CreateEngine: async count => ({ session: { count }, Close: async () => { closed.push('counter'); } }) })
  ]);
  expect(text.engine.read()).toBe('ok');
  await service.Destroy(text.id);
  expect(counter.engine.count).toBe(3);
  expect(closed).toEqual(['text']);
  await service.Destroy(counter.id);
  expect(closed).toEqual(['text', 'counter']);
});

it('主 Agent 跨轮保留身份与累计值，仅执行中维护两秒速率窗口', async () => {
  const org = new Organization();
  const agent = org.MainAgent();
  const role = new AgentRole({ id: 'main', name: 'Main', instructions: '' }, { workspaceId: 'w', taskId: 't' });
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  try {
    const factory = { parameters: 0, CreateEngine: async (_: number, id: string, _role: AgentRole, report: (seq: number, type: 'message' | 'summary', total: number) => void) => ({ session: report, Close: async () => {} }) };
    const first = await agent.Open(role, factory);
    first.engine(1, 'message', 80);
    first.engine(1, 'message', 80);
    first.engine(2, 'summary', 120);
    expect(agent.usage.Read(100)).toMatchObject({ state: 'executing', totalTokens: 120, tokensPerSecond: 60 });
    expect(agent.usage.Read(2100).tokensPerSecond).toBe(0);
    await agent.Close();
    expect(org.MainAgent()).toBe(agent);
    expect(agent.usage.Read(2200)).toMatchObject({ state: 'idle', totalTokens: 120, tokensPerSecond: 0 });
    clock.mockReturnValue(3000);
    const second = await agent.Open(role, factory);
    first.engine(3, 'message', 500);
    second.engine(1, 'summary', 40);
    expect(agent.usage.totalTokens).toBe(160);
    expect(agent.usage.tokensPerSecond).toBe(20);
    await agent.Close();
  } finally { clock.mockRestore(); }
});

it('仅在 Token 窗口到期时推送速率，空闲时没有定时任务', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  try {
    const org = new Organization();
    const agent = org.MainAgent();
    const updates = vi.fn();
    const cancel = agent.Subscribe(updates);
    const role = new AgentRole({ id: 'main', name: 'Main', instructions: '' }, { workspaceId: 'w', taskId: 't' });
    const { engine: report } = await agent.Open(role, { parameters: 0, CreateEngine: async (_p, _id, _role, report) => ({ session: report, Close: async () => {} }) });
    report(1, 'message', 60);
    await vi.advanceTimersByTimeAsync(2000);
    expect(updates.mock.calls.flat()).toEqual(['executing', 'tokens', 'rate']);
    expect(agent.usage.tokensPerSecond).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    report(2, 'message', 20);
    await agent.Close();
    expect(updates).toHaveBeenLastCalledWith('idle');
    expect(vi.getTimerCount()).toBe(0);
    cancel();
  } finally { vi.useRealTimers(); }
});
