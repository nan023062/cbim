import {expect,it,vi} from 'vitest';
import {dispatchApplication} from '../src/bridge/server/ipc/dispatch';
import type {ApplicationServices} from '../src/bridge/server/ipc/services';
import {checkedIpcCall,parseIpcRequest} from '../src/bridge/contracts/ipc-call';

it.each([
  ['workspace.members.commit','MEMBER_INPUT_INVALID'],['workspace.ownerships.commit','OWNERSHIP_INPUT'],
  ['governance.apply','GOVERNANCE_INPUT'],['resources.connection.grant','REPOSITORY_CONNECTION_INPUT'],
  ['dispatch.fileCompensate','FILE_COMPENSATION_PRE_ACCEPT_INPUT'],['dispatch.effectDisposition','EFFECT_PREACCEPT_INPUT_INVALID'],
  ['dispatch.humanDecide','HUMAN_INPUT_INVALID'],['loop.goalContinue','GOAL_CONTINUATION_INPUT'],
  ['loop.humanContinue','HUMAN_CONTINUATION_INPUT'],['loop.recoveryStart','RECOVERY_INPUT_INVALID'],['loop.replanStart','REPLAN_INPUT_INVALID'],
  ['github.feedback.begin','GITHUB_CONFIG'],['chat.import','ATTACHMENT_IMPORT_INPUT'],
])('畸形 %s 保留受理前错误码 %s 且不取得服务',async(action,code)=>{
  const accessed=vi.fn();const app=new Proxy({isStopping:false},{get:(target,key)=>{if(key==='isStopping')return target.isStopping;accessed(key);throw Error('Service must not be touched')}}) as unknown as ApplicationServices;
  await expect(dispatchApplication(app,action,{})).rejects.toMatchObject({code});expect(accessed).not.toHaveBeenCalled();
});
it('关闭及退役拒绝优先；未知操作不能透过对象原型命中处理器',async()=>{
  const app={isStopping:true} as ApplicationServices;
  await expect(dispatchApplication(app,'governance.apply',{})).rejects.toMatchObject({code:'SHUTTING_DOWN'});
  await expect(dispatchApplication(app,'loop.start',{})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
  for(const action of ['constructor','toString','__proto__','not.registered'])await expect(dispatchApplication(app,action,{})).rejects.toMatchObject({code:'ACTION'});
});
it('动态表单经过对应 Schema；不补猜执行身份，也不接受多余的授权字段',()=>{
  expect(checkedIpcCall('agentHistory.sessions',{workspaceId:'w',agentId:'cbim:main'})).toEqual(['agentHistory.sessions',{workspaceId:'w',agentId:'cbim:main',limit:30}]);
  expect(()=>checkedIpcCall('loop.queueInsert',{id:'w',taskId:'t',queueId:'q'})).toThrow();
  expect(()=>parseIpcRequest('workspace.ownerships.list',{workspaceId:'w',instanceId:'i',actor:{kind:'local_desktop'}})).toThrow();
  expect(parseIpcRequest('loop.answerQuestion',{id:'w',taskId:'t',questionId:'q',answers:[{option:null,other:'说明'}]})).toBeDefined();
});
