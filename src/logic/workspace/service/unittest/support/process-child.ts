import {Application} from '../../../../../bridge/server/application';
import {Paths} from '../../paths';
import {Workspace} from '../../workspace';
import {randomUUID} from 'node:crypto';
import {writeSync} from 'node:fs';
import path from 'node:path';
async function main(){
const [mode,root,user]=process.argv.slice(2);
const app=new Application(new Paths(user,path.resolve('.')));
await app.Init();const entry=await app.catalog.Add(root);
if(mode==='catalog'){console.log(entry.id);process.exit(0)}
if(mode==='crash'){
  await app.Stop(entry.id); // 启动时已打开登记工作区，故障注入前先释放正常实例。
  const ws=new Workspace(entry,app.paths,app.rules,n=>{if(n===1)process.exit(88)});await ws.Open();
  // 在强制退出前同步写出实例 ID，避免管道缓冲影响崩溃恢复断言。
  writeSync(1,JSON.stringify({instanceId:ws.instanceId})+'\n');
  const s=await ws.Read();await ws.Commit({workspaceId:s.workspaceId,instanceId:s.instanceId,revision:s.revision,requestId:randomUUID(),changes:[{path:'.cbim/README.md',text:'# interrupted'},{path:'.cbim/new.md',text:'# second'}]});
}
}
void main().catch(e=>{console.error(e);process.exit(1)});
