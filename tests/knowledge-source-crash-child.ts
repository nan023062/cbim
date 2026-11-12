import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {knowledgeSourceFixture as data} from './knowledge-source-lifecycle-fixture';

// Test-only separate process: hold precisely after the actual committed knowledge journal and before the real source final write.
async function main(){
  const [user,workspaceId]=process.argv.slice(2);assert.ok(user&&workspaceId&&process.send);
  const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await app.init();
  const workspace=app.workspace(workspaceId),coordinator=workspace.sources;assert.ok(coordinator);
  const snapshot=await workspace.snapshot(),preview=await app.dispatch('architecture.preview',{workspaceId,instanceId:workspace.instanceId,revision:snapshot.revision,operations:[{kind:'agent',action:'update',id:data.agentId,body:data.changedPrinciples}]});
  const realSettle=coordinator.settle.bind(coordinator);
  coordinator.settle=async(...args)=>{
    if(args[1]!=='committed')return realSettle(...args);
    const journalPath=path.join(user,workspaceId,'transactions',preview.planId+'.json'),journal=JSON.parse(await fs.readFile(journalPath,'utf8'));assert.equal(journal.state,'committed');assert.equal(journal.result.state,'committed');
    process.send!({kind:'actual-committed-before-source-final',pid:process.pid,planId:preview.planId,journalPath,transitionId:args[0].transition.transitionId});
    await new Promise<void>(()=>{});
  };
  await app.dispatch('architecture.commit',{workspaceId,instanceId:workspace.instanceId,planId:preview.planId});
  throw Error('Held commit unexpectedly returned');
}
void main().catch(error=>{process.send?.({kind:'error',message:String(error),stack:error instanceof Error?error.stack:undefined});process.exitCode=1});
