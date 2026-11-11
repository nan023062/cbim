import {workspaceMemberPreviewSchema} from '../src/bridge/contracts/workspace-members';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';
import {WorkspaceMemberCommands} from '../src/frontend/team/workspace-member-state';
import {ModuleOwnershipCommands} from '../src/frontend/workspace/module-ownership-state';
import {assignInlineOwner,readInlineOwners,inlineOwnerChoices} from '../src/frontend/workspace/inline-module-ownership';

it('新岗位采纳 Agent 自选引擎和模型；失效选择不回落到本机默认',async()=>{
  const f=await setup();try{
    const settings=await f.app.models.save({profile:{name:'Claude for Agent',engine:'claude-code',api:'anthropic-messages',baseUrl:'http://127.0.0.1:1',auth:'none',models:[{id:'cc',name:'Claude',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}],defaultModel:'cc'}});
    const profileId=settings.profiles.find(p=>p.engine==='claude-code')!.id;
    Object.assign(f.agents[0],{runtime:{engine:'claude-code',profileId,modelId:'cc'}});
    await f.assign('agent:'+f.team.input.agentId);const member=(await f.ws.dispatchStore.read()).workspaceMembers![0];
    expect(member.runtimePolicy.snapshot).toMatchObject({engine:'claude-code',model:'cc',id:profileId});
    await f.app.models.remove(profileId);await f.assign('member:'+member.memberId,f.team.child);
    expect((await f.ws.dispatchStore.read()).workspaceMembers![0]).toEqual(member);
    const other=await setup();try{Object.assign(other.agents[0],{runtime:{engine:'claude-code',profileId,modelId:'cc'}});await expect(other.assign('agent:'+other.team.input.agentId)).rejects.toThrow('不可用');expect((await other.ws.dispatchStore.read()).workspaceMembers??[]).toEqual([])}finally{await other.cleanup()}
  }finally{await f.cleanup()}
});

async function setup(model=true){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),team=await seedTeam(ws);
  if(model)await f.app.models.save({profile:{name:'Inline fixture',api:'openai-completions',baseUrl:'http://127.0.0.1:1',auth:'none',models:[{id:'fixture',name:'Fixture',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}],defaultModel:'fixture'}});
  const identity={workspaceId:entry.id,instanceId:ws.instanceId},agents=[{id:team.input.agentId,name:'开发者'},{id:'cbim:executor',name:'默认执行者'},{id:'cbim:main',name:'主 Agent'}];
  const saved=new Map<string,string>(),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value)}};
  const calls:string[]=[];let after:(action:string,result:any)=>unknown=()=>{},alive=true;
  const call=async(action:string,args?:unknown)=>{calls.push(action);try{const value=await f.app.dispatch(action,args);after(action,value);return value}catch(error:any){throw Error(error.code?error.code+': '+error.message:String(error))}};
  const controllers=()=>({members:new WorkspaceMemberCommands(entry.id,{storage,uuid:randomUUID,commit:args=>call('workspace.members.commit',args),lookup:args=>call('workspace.members.receipt',args)}),ownerships:new ModuleOwnershipCommands(entry.id,{storage,uuid:randomUUID,commit:args=>call('workspace.ownerships.commit',args),lookup:args=>call('workspace.ownerships.receipt',args)}),call,isCurrent:()=>alive});
  const ports=controllers();
  return {...f,entry,ws,team,identity,agents,calls,ports,controllers,after:(fn:typeof after)=>{after=fn},leave:()=>{alive=false},assign:(value:string,moduleId=team.input.moduleId)=>assignInlineOwner(identity,moduleId,value,agents,ports)};
}

it('一级下拉只包含自定义 Agent，默认主 Agent 不需要登记，选择后真实登记与绑定，复用岗位且不启动执行',async()=>{
  const f=await setup();try{
    const initial=await readInlineOwners(f.identity,f.ports.call);
    expect(inlineOwnerChoices(f.agents,initial.members).map(item=>item.value)).toEqual(['agent:'+f.team.input.agentId]);
    await f.assign('agent:'+f.team.input.agentId);const first=await readInlineOwners(f.identity,f.ports.call),member=first.members[0];
    expect(member).toMatchObject({agentId:f.team.input.agentId,modelId:'fixture',state:'active'});expect(first.views.find(item=>item.moduleId===f.team.input.moduleId)?.binding?.ownerMemberId).toBe(member.memberId);
    await f.assign('member:'+member.memberId,f.team.child);await f.assign('member:'+member.memberId);
    expect(f.calls.filter(action=>action==='workspace.members.commit')).toHaveLength(1);expect(f.calls.filter(action=>action==='workspace.ownerships.commit')).toHaveLength(2);
    await f.assign('agent:'+f.team.input.agentId);await f.assign('');const state=await f.ws.dispatchStore.read();
    expect(state.workspaceMembers).toHaveLength(1);expect(state.moduleOwnerships?.find(item=>item.moduleId===f.team.input.moduleId)?.ownerMemberId).toBeNull();expect(state.graphs).toHaveLength(0);expect(state.runs??[]).toHaveLength(0);
  }finally{await f.cleanup()}
});

it('没有默认模型时不造岗位；已存在岗位不会随默认模型改变而重新采纳',async()=>{
  const f=await setup(false);try{
    await expect(f.assign('agent:'+f.team.input.agentId)).rejects.toThrow('默认模型');expect(f.calls.filter(action=>action.endsWith('.commit'))).toHaveLength(0);
    await f.app.models.save({profile:{name:'Configured',api:'openai-completions',baseUrl:'http://127.0.0.1:1',auth:'none',models:[{id:'old',name:'Old',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}],defaultModel:'old'}});
    await f.assign('agent:'+f.team.input.agentId);const before=(await f.ws.dispatchStore.read()).workspaceMembers![0];
    const settings=await f.app.models.save({profile:{name:'Other',api:'openai-completions',baseUrl:'http://127.0.0.1:1',auth:'none',models:[{id:'new',name:'New',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}],defaultModel:'new'}});
    await f.app.models.select(settings.profiles.find(item=>item.name==='Other')!.id);
    await f.assign('member:'+before.memberId,f.team.child);expect((await f.ws.dispatchStore.read()).workspaceMembers![0]).toEqual(before);
  }finally{await f.cleanup()}
});

it.each(['workspace.members.commit','workspace.ownerships.commit'])('丢失 %s 回包保留真实部分成功，重开只核实不重放',async lost=>{
  const f=await setup();try{
    let dropped=false;f.after(action=>{if(action===lost&&!dropped){dropped=true;throw Error('IPC_TIMEOUT')}});
    await expect(f.assign('agent:'+f.team.input.agentId)).rejects.toThrow('尚未确认');
    expect((await f.ws.dispatchStore.read()).workspaceMembers).toHaveLength(1);
    const writes=f.calls.filter(action=>action.endsWith('.commit')).length;
    await expect(f.assign('agent:'+f.team.input.agentId)).rejects.toThrow('未核实');
    const restored=f.controllers();await restored.members.restore();await restored.ownerships.restore();
    expect(f.calls.filter(action=>action.endsWith('.commit'))).toHaveLength(writes);
    expect((await f.ws.dispatchStore.read()).moduleOwnerships??[]).toHaveLength(lost==='workspace.members.commit'?0:1);
    await assignInlineOwner(f.identity,f.team.input.moduleId,'agent:'+f.team.input.agentId,f.agents,restored);
    expect(f.calls.filter(action=>action==='workspace.members.commit')).toHaveLength(1);expect(f.calls.filter(action=>action==='workspace.ownerships.commit')).toHaveLength(1);
  }finally{await f.cleanup()}
});

it.each(['workspace.members.preview','workspace.members.commit'])('离开原视图后不继续下一步，已受理事实保留：%s',async stopAt=>{
  const f=await setup();try{
    f.after(action=>{if(action===stopAt)f.leave()});await expect(f.assign('agent:'+f.team.input.agentId)).rejects.toThrow('离开');
    const state=await f.ws.dispatchStore.read();expect(state.workspaceMembers??[]).toHaveLength(stopAt==='workspace.members.commit'?1:0);expect(state.moduleOwnerships??[]).toHaveLength(0);
  }finally{await f.cleanup()}
});

it('停用岗位不隐式重建，同 Agent 多个岗位在同级区分；非法或跨实例选择无写入',async()=>{
  const f=await setup();try{
    await expect(f.assign('agent:cbim:main')).rejects.toThrow('不存在');
    await f.assign('agent:'+f.team.input.agentId);await f.assign('');let data=await readInlineOwners(f.identity,f.ports.call);const member=data.members[0];
    const input={...f.identity,change:{kind:'state',memberId:member.memberId,expectedRevision:member.revision,nextState:'suspended',reason:'测试停用'}};
    const preview=workspaceMemberPreviewSchema.parse(await f.ports.call('workspace.members.preview',input));await f.ports.members.submit(input as any,preview);
    await expect(f.assign('agent:'+f.team.input.agentId)).rejects.toThrow('不可用');data=await readInlineOwners(f.identity,f.ports.call);
    expect(inlineOwnerChoices(f.agents,data.members).find(item=>item.value==='member:'+member.memberId)?.disabled).toBe(true);
    const count=f.calls.filter(action=>action.endsWith('.commit')).length;
    await expect(assignInlineOwner({...f.identity,instanceId:randomUUID()},f.team.child,'agent:'+f.team.input.agentId,f.agents,f.ports)).rejects.toThrow();
    expect(f.calls.filter(action=>action.endsWith('.commit'))).toHaveLength(count);
    const choices=inlineOwnerChoices(f.agents,[{...member,name:'岗位 A'},{...member,memberId:randomUUID(),name:'岗位 B'}]);expect(choices.filter(item=>item.label.startsWith('开发者')).map(item=>item.label)).toEqual(['开发者 · 岗位 A','开发者 · 岗位 B']);
  }finally{await f.cleanup()}
});
