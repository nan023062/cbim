import {expect,it} from 'vitest';
import {appendOfficeMemberSessions,officeMemberSessionBusy,type OfficeMemberSession} from '../../../../src/framework/office/session';

const main:OfficeMemberSession={workspaceId:'workspace',officeId:'office-a',sessionId:'main-a',workerId:'cbim:main',createdAt:'2026-11-14T00:00:00.000Z'};
const child:OfficeMemberSession={...main,sessionId:'child-a',workerId:'developer'};

it('主子对话共用模型，同一办公室同一角色幂等，其他办公室独立',()=>{
  const first=appendOfficeMemberSessions([], [main,child], 'workspace');
  expect(appendOfficeMemberSessions(first,[{...child}],'workspace')).toEqual(first);
  expect(appendOfficeMemberSessions(first,[{...child,officeId:'office-b',sessionId:'child-b'}],'workspace')).toHaveLength(3);
  expect(first).toEqual([main,child]);
});

it('拒绝同一角色重复建会话、改绑已有身份和跨工作区写入',()=>{
  const before=[main,child];
  for(const changed of [{...child,sessionId:'duplicate'},{...child,officeId:'office-b'},{...child,workerId:'designer'},{...child,createdAt:'2026-11-14T01:00:00.000Z'}]){
    expect(()=>appendOfficeMemberSessions(before,[changed],'workspace')).toThrow();
  }
  expect(()=>appendOfficeMemberSessions(before,[{...child,workspaceId:'other'}],'workspace')).toThrow();
  expect(before).toEqual([main,child]);
});

it('拒绝私有路径、未知字段和同批重复；输出不共享输入对象',()=>{
  expect(()=>appendOfficeMemberSessions([],[{...child,sessionFile:'private'} as OfficeMemberSession],'workspace')).toThrow();
  expect(()=>appendOfficeMemberSessions([],[child,child],'workspace')).toThrow();
  const next=appendOfficeMemberSessions([main],[child],'workspace');next[0].workerId='changed';next[1].workerId='changed';
  expect(main.workerId).toBe('cbim:main');expect(child.workerId).toBe('developer');
});

it('同一逻辑对话从领取到运行均占槽，其他角色、办公室和已结算运行不互相阻塞',()=>{
  const binding={workspaceId:child.workspaceId,officeId:child.officeId,workerId:child.workerId,runId:'run-a'};
  for(const status of ['starting','running'])expect(officeMemberSessionBusy([child],[{binding,status}],child)).toBe(true);
  expect(officeMemberSessionBusy([child],[{binding,status:'running'}],child,'run-a')).toBe(false);
  expect(officeMemberSessionBusy([],[{binding,status:'running'}],child)).toBe(false);
  for(const change of [{officeId:'office-b'},{workerId:'designer'},{workspaceId:'other'}])expect(officeMemberSessionBusy([child],[{binding:{...binding,...change},status:'running'}],child)).toBe(false);
  for(const status of ['completed','cancelled','failed','interrupted'])expect(officeMemberSessionBusy([child],[{binding,status}],child)).toBe(false);
});
