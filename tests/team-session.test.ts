import {expect,it} from 'vitest';
import {appendTeamSessions,teamSessionBusy,type TeamSession} from '../src/logic/team/rules/team-session';

const main:TeamSession={workspaceId:'workspace',rootSessionId:'office-a',sessionId:'main-a',teamId:'team',agentId:'cbim:main',createdAt:'2026-11-14T00:00:00.000Z'};
const child:TeamSession={...main,sessionId:'child-a',agentId:'developer'};

it('主子对话共用模型，同一办公室同一角色幂等，其他办公室独立',()=>{
  const first=appendTeamSessions([], [main,child], 'workspace');
  expect(appendTeamSessions(first,[{...child}],'workspace')).toEqual(first);
  expect(appendTeamSessions(first,[{...child,rootSessionId:'office-b',sessionId:'child-b'}],'workspace')).toHaveLength(3);
  expect(first).toEqual([main,child]);
});

it('拒绝同一角色重复建会话、改绑已有身份和跨工作区写入',()=>{
  const before=[main,child];
  for(const changed of [{...child,sessionId:'duplicate'},{...child,rootSessionId:'office-b'},{...child,agentId:'designer'},{...child,teamId:'another-team'},{...child,createdAt:'2026-11-14T01:00:00.000Z'}]){
    expect(()=>appendTeamSessions(before,[changed],'workspace')).toThrow();
  }
  expect(()=>appendTeamSessions(before,[{...child,workspaceId:'other'}],'workspace')).toThrow();
  expect(before).toEqual([main,child]);
});

it('拒绝私有路径、未知字段和同批重复；输出不共享输入对象',()=>{
  expect(()=>appendTeamSessions([],[{...child,sessionFile:'private'} as TeamSession],'workspace')).toThrow();
  expect(()=>appendTeamSessions([],[child,child],'workspace')).toThrow();
  const next=appendTeamSessions([main],[child],'workspace');next[0].teamId='changed';next[1].agentId='changed';
  expect(main.teamId).toBe('team');expect(child.agentId).toBe('developer');
});

it('同一逻辑对话从领取到运行均占槽，其他角色、办公室和已结算运行不互相阻塞',()=>{
  const binding={workspaceId:child.workspaceId,rootSessionId:child.rootSessionId,agentId:child.agentId,runId:'run-a'};
  for(const status of ['starting','running'])expect(teamSessionBusy([child],[{binding,status}],child)).toBe(true);
  expect(teamSessionBusy([child],[{binding,status:'running'}],child,'run-a')).toBe(false);
  expect(teamSessionBusy([],[{binding,status:'running'}],child)).toBe(false);
  for(const change of [{rootSessionId:'office-b'},{agentId:'designer'},{workspaceId:'other'}])expect(teamSessionBusy([child],[{binding:{...binding,...change},status:'running'}],child)).toBe(false);
  for(const status of ['completed','cancelled','failed','interrupted'])expect(teamSessionBusy([child],[{binding,status}],child)).toBe(false);
});
