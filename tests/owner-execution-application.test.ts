import {it,expect} from 'vitest';
import {fixture} from './helpers';
import {seedOwnerExecution,ownerExecutionData as data} from './owner-execution-fixture';
import {workspaceMemberHttpProbe,workspaceMemberRuntimeEvidence} from './workspace-member-fixture';
import {moduleOwnershipDetail} from './module-ownership-fixture';
import {randomUUID} from 'node:crypto';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {ownerExecutionDiscoverySchema} from '../src/backend/core/team/owner-execution-discovery';

it('explicitly configures two positions of the same Agent with distinct models/adaptation and module sources without executing a model',async()=>{
  const f=await fixture(),probe=await workspaceMemberHttpProbe();
  try{
    const seeded=await seedOwnerExecution(f.app,f.a,{main:probe.url+'/main',a:probe.url+'/a',b:probe.url+'/b'});
    expect(new Set(seeded.profiles.map(profile=>profile.id)).size).toBe(3);
    expect(seeded.profiles.map(profile=>profile.modelId)).toEqual([data.mainModel,...data.models]);
    const [a,b]=seeded.positions.map(position=>position.member);
    expect(a.memberId).not.toBe(b.memberId);expect(a.adoption.configuration.agentId).toBe(b.adoption.configuration.agentId);
    expect(a.adoption.capabilityHash).toBe(b.adoption.capabilityHash);expect(a.adoption.sourceRef).toEqual(b.adoption.sourceRef);
    for(const [index,position] of seeded.positions.entries()){
      expect(position.member.adaptation.instructions).toBe(data.adaptations[index]);
      expect(position.member.runtimePolicy.profileId).toBe(seeded.profiles[index+1].id);
      expect(position.member.runtimePolicy.modelId).toBe(data.models[index]);
      expect(position.member.runtimePolicy.profileId).not.toBe(seeded.profiles[0].id);
      const detail=await moduleOwnershipDetail(f.app,seeded.entry.id,seeded.modules[index]);
      expect(detail.view.binding?.ownerMemberId).toBe(position.member.memberId);expect(detail.view.sourceStatus?.status).toBe('current');
    }
    expect((await moduleOwnershipDetail(f.app,seeded.entry.id,seeded.extraModule)).view.binding?.ownerMemberId).toBe(a.memberId);
    expect((await moduleOwnershipDetail(f.app,seeded.entry.id,seeded.team.child)).view.binding).toBeNull();
    const discovery=ownerExecutionDiscoverySchema.parse(await f.app.memberDispatch(seeded.entry.id).owners.discover([...seeded.modules,seeded.extraModule,seeded.team.child]));
    expect(discovery.groups).toHaveLength(3);
    expect(discovery.groups.find(group=>group.memberId===a.memberId)?.selection?.expectedOwners.map(owner=>owner.moduleId)).toEqual([seeded.modules[0],seeded.extraModule]);
    expect(discovery.groups.find(group=>group.moduleIds.includes(seeded.team.child))).toMatchObject({moduleIds:[seeded.team.child],issues:[{code:'OWNER_UNASSIGNED'},{code:'OWNER_MODEL_UNRESOLVED'}]});
    const runtime=await workspaceMemberRuntimeEvidence(f.app,[seeded.entry.id]);
    expect(runtime[0].runs).toEqual([]);expect(runtime[0].scopes).toEqual([]);expect(runtime[0].mainSessions).toEqual([]);
    expect(probe.requests).toEqual([]);
  }finally{await f.cleanup();await probe.close()}
},60000);

it('rejects direct business entry and scope-less dispatch while missing/suspended/changed model gaps do not fall back to the main configuration',async()=>{
  const f=await fixture(),probe=await workspaceMemberHttpProbe();
  try{
    const seeded=await seedOwnerExecution(f.app,f.a,{main:probe.url+'/main',a:probe.url+'/a',b:probe.url+'/b'}),id=seeded.entry.id,dispatch=f.app.memberDispatch(id),a=seeded.positions[0].member;
    const current=ownerExecutionDiscoverySchema.parse(await dispatch.owners.discover([seeded.modules[0]]));expect(current.groups[0].selection).toBeDefined();
    await expect(f.app.dispatch('loop.start',{id,task:{goal:data.goals[0],agentId:seeded.team.input.agentId,moduleId:seeded.modules[0],acceptance:[...data.acceptance]},options:seeded.mainOptions})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    await expect(f.app.dispatch('dispatch.task',{workspaceId:id,rootSessionId:'no-active-main',commandId:randomUUID(),expectedParentRevision:1,task:{assigneeAgentId:seeded.team.input.agentId,moduleIds:[seeded.modules[0]],ownerSelection:current.groups[0].selection,goal:data.goals[0],acceptance:[{id:'read',text:data.acceptance[0]}],prerequisites:[]}})).rejects.toMatchObject({code:'DISPATCH_SCOPE_REQUIRED'});
    await commitWorkspaceMember(f.app,id,{kind:'state',memberId:a.memberId,expectedRevision:a.revision,nextState:'suspended',reason:'明确暂停岗位，不得回退到同 Agent 的另一个岗位'});
    const suspended=await dispatch.owners.discover([seeded.modules[0]]);expect(suspended.groups[0].selection).toBeUndefined();expect(suspended.groups[0].issues.length).toBeGreaterThan(0);expect(suspended.groups[0].memberId).toBe(a.memberId);
    const profile=seeded.profiles[2];await f.app.models.save({id:profile.id,profile:{...profile.definition,models:profile.definition.models.map(model=>({...model,maxTokens:2048}))}});
    const changed=await dispatch.owners.discover([seeded.modules[1]]);expect(changed.groups[0].selection).toBeUndefined();expect(changed.groups[0].issues).toContainEqual(expect.objectContaining({code:'OWNER_MODEL_CHANGED'}));
    expect((await workspaceMemberRuntimeEvidence(f.app,[id]))[0]).toMatchObject({runs:[],scopes:[],mainSessions:[]});expect(probe.requests).toEqual([]);
  }finally{await f.cleanup();await probe.close()}
},60000);
