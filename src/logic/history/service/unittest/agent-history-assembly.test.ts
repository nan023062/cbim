import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createAgentHistory,type AgentHistoryWorkspace} from '../assembly';
import {RunJournal} from '../../../execution/storage/run-journal';
import type {TaskSpec} from '../../../execution/rules/types';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()});
const identity={workspaceId:'workspace',agentId:'cbim:main',sessionId:'session',taskId:'task',runId:'run'};
async function setup(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-history-assembly-')),project=path.join(root,'project');
  cleanups.push(()=>fs.rm(root,{recursive:true,force:true}));
  const owner:AgentHistoryWorkspace={entry:{id:identity.workspaceId,path:root},paths:{Project:()=>project},Assert:vi.fn()};
  const task:TaskSpec={taskId:identity.taskId,workspaceId:identity.workspaceId,root,goal:'归档',mode:'chat',agentId:identity.agentId,moduleIds:[],acceptance:[]};
  const directory=path.join(project,'loop-engine','tasks',identity.taskId,identity.runId),journal=new RunJournal(directory,task,identity.runId);await journal.Init();
  await journal.Append({type:'run.started',data:{task,message:task.goal,conversationBinding:{workspaceId:identity.workspaceId,teamId:'team',agentId:identity.agentId,agentInstanceId:'instance',agentSessionId:identity.sessionId,rootSessionId:identity.taskId}}});
  await journal.Append({type:'message',data:{role:'assistant',text:'原始历史'}});
  await journal.Append({type:'run.settled',data:{status:'completed'}});
  const seed=createAgentHistory(owner);await seed.Initialize();seed.RestoreRun(await RunJournal.Read(directory),'loop');await seed.Close();
  const history=createAgentHistory(owner);cleanups.push(()=>history.Close());await history.Initialize();
  return {root,project,directory,owner,history};
}
it('仅凭最小工作区能力装配；列表只查索引，详情核实存活并读取 canonical，关闭后拒绝',async()=>{
  const f=await setup();
  expect((await f.history.Roles({workspaceId:identity.workspaceId})).roles).toHaveLength(1);expect(f.owner.Assert).not.toHaveBeenCalled();
  expect(JSON.stringify(await f.history.Events(identity))).toContain('原始历史');expect(f.owner.Assert).toHaveBeenCalledTimes(1);
  await f.history.Close();await expect(f.history.Roles({workspaceId:identity.workspaceId})).rejects.toMatchObject({code:'AGENT_HISTORY_CLOSED'});
});
it('原日志身份被替换后拒绝，不从索引伪造可读正文',async()=>{
  const f=await setup(),file=path.join(f.directory,'events.jsonl');
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll('"workspace"','"another-workspace"'));
  await expect(f.history.Events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
it('工作区存活断言失败后不提供 canonical 正文',async()=>{
  const f=await setup();vi.mocked(f.owner.Assert).mockImplementation(()=>{throw Error('workspace retired')});
  await expect(f.history.Events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
it('运行目录经符号链接或 Windows junction 指向其它位置时拒绝',async()=>{
  const f=await setup(),moved=path.join(f.root,'moved-run');await fs.rename(f.directory,moved);await fs.symlink(moved,f.directory,process.platform==='win32'?'junction':'dir');
  await expect(f.history.Events(identity)).rejects.toMatchObject({code:'AGENT_HISTORY_UNREADABLE'});
});
