import {it,expect} from 'vitest';
import {Team} from '../../../../../src/framework/cability/team';
import {Agent,runAgentTask,type AgentTaskExecution} from '../../../../../src/framework/cability/agent';

it('freezes identity and model selection without copying conversation messages',()=>{
  const model={engine:'pi',profileId:'profile',modelId:'model'},definition={id:'agent',name:'Agent',instructions:'role',model},conversation={workspaceId:'workspace',taskId:'task'};
  const agent=new Agent(definition,conversation);definition.name='changed';conversation.taskId='other';model.modelId='changed';
  expect(agent.definition.name).toBe('Agent');expect(agent.conversation.taskId).toBe('task');expect(agent.definition.model?.modelId).toBe('model');expect(Object.isFrozen(agent.definition)).toBe(true);expect(Object.isFrozen(agent.definition.model)).toBe(true);
});

it('groups office positions by team and observes only the environment supplied for this call',async()=>{
  const model={engine:'pi',profileId:'p',modelId:'m'};
  const writer={kind:'agent' as const,id:'writer',agentId:'developer',name:'Writer',position:'implementation',available:true,model};
  const engineering=new Team('engineering',[writer]);
  const reviewer={...writer,id:'reviewer',agentId:'reviewer'};
  const organization=new Team('company',[engineering,reviewer]);
  expect(organization.children).toEqual([engineering,reviewer]);
  expect(organization.FindMember('writer')).toEqual(writer);
  expect(organization.FindMember('reviewer')).toEqual(reviewer);
  expect(organization.FindMember('developer')).toBeUndefined();
  expect(engineering.children).toEqual([writer]);
  expect(()=>new Team('empty',[])).toThrow('团队至少需要一个子节点');
  const role={id:'developer',name:'Writer',instructions:'',model};
  const environment={organization,modules:[{id:'editor',ownerMemberId:'writer'}]};
  const agent=new Agent(role,{workspaceId:'project',taskId:'child'},async()=>environment);
  expect(await agent.Observe?.()).toEqual(environment);
});

it('waits for forwarded output before summarizing local and remote work',async()=>{
  const events:string[]=[];
  const agent=new Agent({id:'a',name:'A',instructions:''},{workspaceId:'w',taskId:'t'},async()=>{
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
    const agent=new Agent(definition,{workspaceId:'w',taskId:'t'});
    expect(await runAgentTask(agent,'检查交付',execution)).toMatchObject({conclusion:position+' / '+content});
    await expect(runAgentTask(agent,'检查交付',{...execution,Decompose:async()=>[{kind:'local',task:'check',skillIds:['other']}]})).rejects.toThrow('当前岗位没有采用该技能');
  }
});
