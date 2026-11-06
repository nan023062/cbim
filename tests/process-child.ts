import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {Workspace} from '../src/backend/main/workspace/workspace';
import {serve} from '../src/backend/main/integrations/mcp/mcp';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
async function main(){
const [mode,root,user]=process.argv.slice(2);
const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));
await app.init();const entry=await app.catalog.add(root);
if(mode==='catalog'){console.log(entry.id);process.exit(0)}
if(mode==='crash'){
  await app.stop(entry.id); // init now starts registered services before fault injection.
  const ws=new Workspace(entry,app.paths,app.rules,n=>{if(n===1)process.exit(88)});await ws.open(serve);const s=await ws.read();await ws.commit({workspaceId:s.workspaceId,instanceId:s.instanceId,revision:s.revision,requestId:randomUUID(),changes:[{path:'.cbim/README.md',text:'# interrupted'},{path:'.cbim/new.md',text:'# second'}]});
}
}
void main().catch(e=>{console.error(e);process.exit(1)});
