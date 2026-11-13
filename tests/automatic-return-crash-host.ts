import fs from 'node:fs/promises';
import path from 'node:path';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';

// 独立进程只在真实成员已落盘、主回传尚未发起的窗口停住，由父测试强制终止。
async function main(){
const [user,id,message,marker,mode]=process.argv.slice(2);
const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));
await app.init();await app.open(id);
app.execution(id).continueFromResults=async(taskId)=>{
  const history=await app.execution(id).thread(taskId);
  const identity={workspaceId:id,rootSessionId:taskId},graph=await app.memberDispatch(id).snapshot(identity),scopeId=graph.tasks[0].scopeId!;
  if(mode==='restart-pending')await app.memberDispatch(id).registerMainRun(identity,scopeId,'unlogged-return');
  if(mode==='restart-stopped')await app.memberDispatch(id).closeScope(identity,scopeId,'cancelled');
  await fs.writeFile(marker,JSON.stringify({taskId,runId:history[0].runId}));
  return new Promise(()=>{});
};
await app.dispatch('loop.chat',{id,message,options:{permission:'execute',turnTimeoutMs:15000}});
setInterval(()=>{},1000);
}
void main().catch(error=>{console.error(error);process.exitCode=1});
