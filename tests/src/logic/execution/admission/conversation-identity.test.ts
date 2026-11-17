// logic/execution/admission: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request} from '../../knowledge/rules/data/knowledge';
import {seedTeam} from '../../knowledge/service/support/team-fixture';
import {registerExplicitFixtureOwner} from '../../team/service/support/explicit-owner-fixture';
import type {Application} from '../../../../../src/bridge/server/application';

async function registerExecutor(app:Application,workspaceId:string,moduleId:string){
  const settings=await app.models.Save({profile:{name:'Conversation identity fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false}]}}),profile=settings.profiles.find(item=>item.name==='Conversation identity fixture')!;
  return registerExplicitFixtureOwner(app,workspaceId,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:profile.id,modelId:'fixture'});
}
import {json} from '../../../../../src/core/platform/node/serialization';
import type {TaskSpec} from '../../../../../src/logic/tasks/rules/types';
import {WorkspaceExecutionLease} from '../../../../../src/logic/execution/admission/workspace-lease';
import {FileDispatchStore} from '../../../../../src/logic/dispatch/storage/dispatch-store';

it('同一实例聊天与任务即使只读也互斥，其他实例只读可并行；释放后能重新领取且通知只发一次',()=>{
  const lease=new WorkspaceExecutionLease(),released=vi.fn();lease.ObserveRelease(released);
  const chat=lease.Acquire('conversation:1','read','main-1');
  expect(()=>lease.Acquire('member:1','read','main-1')).toThrowError(expect.objectContaining({code:'MEMBER_BUSY'}));
  const other=lease.Acquire('conversation:2','read','main-2');
  expect(()=>lease.Acquire('member:write','ask','writer')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  chat();chat();expect(released).toHaveBeenCalledTimes(1);
  const self=lease.Acquire('member:1','read','main-1');
  expect(()=>lease.Acquire('conversation:1','read','main-1')).toThrowError(expect.objectContaining({code:'MEMBER_BUSY'}));
  other();self();expect(released).toHaveBeenCalledTimes(3);
  const write=lease.Acquire('member:write','execute','writer');write();
});

it('主运行内核证独立持有读占用，外部读取与错误会话不能借用独占，父释放不提前解锁',()=>{
  const lease=new WorkspaceExecutionLease(),main=lease.Acquire('conversation:main','execute','main');
  expect(()=>lease.Acquire('desktop-preview','read')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  expect(()=>lease.AcquireReadWithin('wrong-proof','conversation:other')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  expect(()=>lease.AcquireReadWithin('conversation:main','conversation:main')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  const proof=lease.AcquireReadWithin('human-proof','conversation:main');
  main();expect(()=>lease.Acquire('member:writer','ask')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));
  const parallel=lease.Acquire('parallel-reader','read');parallel();proof();proof();
  const next=lease.Acquire('member:writer','execute');next();
  const fallback=lease.AcquireReadWithin('after-main','conversation:main');
  expect(()=>lease.Acquire('new-writer','execute')).toThrowError(expect.objectContaining({code:'WORKSPACE_EXECUTION_BUSY'}));fallback();
  const final=lease.Acquire('new-writer','execute');final();
});
