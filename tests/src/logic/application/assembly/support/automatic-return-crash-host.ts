import fs from 'node:fs/promises';
import path from 'node:path';
import {Application} from '../../../../../../src/bridge/server/application';
import {Paths} from '../../../../../../src/logic/workspace/service/paths';

// Real isolated host: parent controls provider response windows, never replaces runtime methods.
async function main(){
  const [user,id,message,marker,mode]=process.argv.slice(2);
  const app=new Application(new Paths(user,path.resolve('.')));
  await app.Init();await app.Open(id);
  const started=await app.Dispatch('loop.chat',{id,message,options:{permission:'execute',turnTimeoutMs:60000}});
  await fs.writeFile(marker,JSON.stringify(started));
  if(mode==='restart-stopped'){
    while(!await fs.access(marker+'.stop').then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,30));
    await app.Dispatch('loop.stop',{id,taskId:started.taskId});
    await fs.writeFile(marker+'.stopped','stopped');
  }
  setInterval(()=>{},1000);
}
void main().catch(error=>{console.error(error);process.exitCode=1});
