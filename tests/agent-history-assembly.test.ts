import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createAgentHistory,type AgentHistoryWorkspace} from '../src/backend/main/history/assembly';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import type {TaskSpec} from '../src/backend/core/execution/types';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()});
const identity={workspaceId:'workspace',agentId:'cbim:main',sessionId:'session',taskId:'task',runId:'run'};
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-history-assembly-')),project=path.join(root,'project');
  cleanups.push(()=>fs.rm(root,{recursive:true,force:true}));
  const owner:AgentHistoryWorkspace={entry:{id:identity.workspaceId,path:root},paths:{project:()=>project},assert:vi.fn()};
  const task:TaskSpec={taskId:identity.taskId,workspaceId:identity.workspaceId,root,goal:'归档',mode:'chat',agentId:identity.agentId,moduleIds:[],acceptance:[]};
  const directory=path.join(project,'loop-engine','tasks',identity.taskId,identity.runId),journal=new RunJournal(directory,task,identity.runId);await journal.init();
  await journal.append({type:'run.started',data:{task,message:task.goal,conversationBinding:{workspaceId:identity.workspaceId,teamId:'team',agentId:identity.agentId,agentInstanceId:'instance',agentSessionId:identity.sessionId,rootSessionId:identity.taskId}}});
  await journal.append({type:'message',data:{role:'assistant',text:'原始历史'}});
  await journal.append({type:'run.settled',data:{status:'completed'}});
  const seed=createAgentHistory(owner);await seed.initialize();seed.restoreRun(await RunJournal.read(directory),'loop');await seed.close();
  const history=createAgentHistory(owner);cleanups.push(()=>history.close());await history.initialize();
  return {root,project,directory,owner,history};
}
it('仅凭最小工作区能力装配；列表只查索引，详情核实存活并读取 canonical，关闭后拒绝',async()=>{
  const f=await setup();
  expect((await f.history.roles({workspaceId:identity.workspaceId})).roles).toHaveLength(1);expect(f.owner.assert).not.toHaveBeenCalled();
  expect(JSON.stringify(await f.history.events(identity))).toContain('原始历史');expect(f.owner.assert).toHaveBeenCalledTimes(1);
  await f.history.close();await expect(f.history.roles({workspaceId:identity.workspaceId})).rejects.toMatchObject({code:'AGENT_HISTORY_CLOSED'});
});
it('原日志身份被替换后拒绝，不从索引伪造可读正文',async()=>{
  const f=await setup(),file=path.join(f.directory,'events.jsonl');
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll('"workspace"','"another-workspace"'));
  await expect(f.history.events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
it('工作区存活断言失败后不提供 canonical 正文',async()=>{
  const f=await setup();vi.mocked(f.owner.assert).mockImplementation(()=>{throw Error('workspace retired')});
  await expect(f.history.events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
it('运行目录经符号链接或 Windows junction 指向其它位置时拒绝',async()=>{
  const f=await setup(),moved=path.join(f.root,'moved-run');await fs.rename(f.directory,moved);await fs.symlink(moved,f.directory,process.platform==='win32'?'junction':'dir');
  await expect(f.history.events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
