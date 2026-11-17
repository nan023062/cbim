import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {knowledgeSourceFixture as data} from './knowledge-source-lifecycle-fixture';

// Test-only separate process: hold precisely after the actual committed knowledge journal and before the real source final write.
async function main(){
  const [user,workspaceId]=process.argv.slice(2);assert.ok(user&&workspaceId&&process.send);
  const app=new Application(new Paths(user,path.resolve('.')));await app.Init();
  const workspace=app.Workspace(workspaceId),coordinator=workspace.sources;assert.ok(coordinator);
  const snapshot=await workspace.Snapshot(),preview=await app.Dispatch('architecture.preview',{workspaceId,instanceId:workspace.instanceId,revision:snapshot.revision,operations:[{kind:'agent',action:'update',id:data.agentId,body:data.changedPrinciples}]});
  const realSettle=coordinator.Settle.bind(coordinator);
  coordinator.Settle=async(...args)=>{
    if(args[1]!=='committed')return realSettle(...args);
    const journalPath=path.join(user,workspaceId,'transactions',preview.planId+'.json'),journal=JSON.parse(await fs.readFile(journalPath,'utf8'));assert.equal(journal.state,'committed');assert.equal(journal.result.state,'committed');
    process.send!({kind:'actual-committed-before-source-final',pid:process.pid,planId:preview.planId,journalPath,transitionId:args[0].transition.transitionId});
    await new Promise<void>(()=>{});
  };
  await app.Dispatch('architecture.commit',{workspaceId,instanceId:workspace.instanceId,planId:preview.planId});
  throw Error('Held commit unexpectedly returned');
}
void main().catch(error=>{process.send?.({kind:'error',message:String(error),stack:error instanceof Error?error.stack:undefined});process.exitCode=1});
