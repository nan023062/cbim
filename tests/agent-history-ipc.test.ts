import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import {type AgentHistoryQueryPort} from '../src/backend/main/ipc/agent-history';
import {dispatchApplication} from '../src/backend/main/ipc/dispatch';
import type {Application} from '../src/backend/main/application';
import {agentHistoryRequests,isAgentHistoryAction} from '../src/bridge/contracts/agent-history-ipc';
import {ipcRequests} from '../src/bridge/contracts/ipc-call';

const workspaceId='workspace';
function setup(){
  const port:AgentHistoryQueryPort={roles:vi.fn(async()=>({roles:[],diagnostics:[]})),sessions:vi.fn(async()=>({items:[],diagnostics:[]})),runs:vi.fn(async()=>({items:[],diagnostics:[]})),events:vi.fn(async()=>{throw Error('canonical unavailable')})};
  const app={agentHistory:vi.fn((_workspaceId:string)=>port)};return {app,port};
}
it('四项查询在查找服务前解析，补齐默认分页并保持原异常',async()=>{
  const {app,port}=setup(),identity={workspaceId,agentId:'cbim:main',sessionId:'session',taskId:'task',runId:'run'};
  expect(await dispatchApplication(app as unknown as Application,'agentHistory.roles',{workspaceId})).toEqual({roles:[],diagnostics:[]});
  await dispatchApplication(app as unknown as Application,'agentHistory.sessions',{workspaceId,agentId:identity.agentId});
  expect(port.sessions).toHaveBeenCalledWith({workspaceId,agentId:identity.agentId,limit:30});
  await dispatchApplication(app as unknown as Application,'agentHistory.runs',{workspaceId,agentId:identity.agentId,sessionId:identity.sessionId,limit:1});
  expect(port.runs).toHaveBeenCalledWith({workspaceId,agentId:identity.agentId,sessionId:identity.sessionId,limit:1});
  await expect(dispatchApplication(app as unknown as Application,'agentHistory.events',identity)).rejects.toThrow('canonical unavailable');
  expect(port.events).toHaveBeenCalledWith({...identity,limit:200});
  expect(app.agentHistory.mock.calls.every(([id])=>id===workspaceId)).toBe(true);
});
it('畸形身份、额外字段、越界分页和错误游标不进入服务',async()=>{
  const {app}=setup();
  const bad:[typeof app,string,unknown][]=[
    [app,'agentHistory.roles',{workspaceId:'../other'}],
    [app,'agentHistory.roles',{workspaceId,root:'outside'}],
    [app,'agentHistory.sessions',{workspaceId,agentId:'main',limit:101}],
    [app,'agentHistory.runs',{workspaceId,agentId:'main'}],
    [app,'agentHistory.events',{workspaceId,agentId:'main',sessionId:'s',taskId:'t',runId:'r',cursor:'wrong'}],
  ];
  for(const request of bad)await expect(dispatchApplication(request[0] as unknown as Application,request[1],request[2])).rejects.toThrow();
  expect(app.agentHistory).not.toHaveBeenCalled();
});
it('未知操作和原型属性不落入历史处理器，保留主分派未知操作拒绝',async()=>{
  for(const action of ['agentHistory.unknown','toString','constructor','__proto__'])expect(isAgentHistoryAction(action)).toBe(false);
  await expect(dispatchApplication({} as Application,'agentHistory.unknown',{})).rejects.toMatchObject({code:'ACTION'});
});
it('172 项契约与实际应用处理器、桌面入口完整对应',()=>{
  const names=new Set<string>();
  // 自动化沿用 0.1.7 的 actions 文件名，同样纳入真实处理器与共享契约的双向覆盖核对。
  for(const file of [...fs.readdirSync('src/backend/main/ipc').filter(name=>name.endsWith('-handlers.ts')||name==='agent-history.ts'||name==='automation-actions.ts').map(name=>'src/backend/main/ipc/'+name),'src/backend/main/main.ts']){
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=(node:ts.Node)=>{
      if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.name))names.add(node.name.text);
      if(ts.isBinaryExpression(node)&&node.left.getText(source)==='action'&&node.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&ts.isStringLiteral(node.right))names.add(node.right.text);
      ts.forEachChild(node,visit);
    };visit(source);
  }
  expect([...names].sort()).toEqual(Object.keys(ipcRequests).sort());
  expect(names.size).toBe(172);
  expect(Object.keys(agentHistoryRequests)).toHaveLength(4);
});
