import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seedKnowledgeSource,knowledgeSourceDiskEvidence,knowledgeSourceHttpProbe} from './knowledge-source-lifecycle-fixture';

export const knowledgeSourceLegacyExecutable=()=>path.resolve(process.env.CBIM_SOURCE_LEGACY_EXE??'build/20261107-222611/CBIM Assistant-win32-x64/CBIM.exe');

/** Produce genuine old-format records with the fixed pre-source application, then close it before a current Application opens the exact same workspace. */
export async function createKnowledgeSourceLegacyFixture(){
  const executable=knowledgeSourceLegacyExecutable();await fs.access(executable);assert.ok(executable.includes('20261107-222611'));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-source-legacy-')),user=path.join(temp,'user'),probe=await knowledgeSourceHttpProbe();
  const errors:string[]=[];let desktop:Awaited<ReturnType<typeof electron.launch>>|undefined;
  try{
    desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
    const page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!(window as any).cbim);
    const call=(action:string,input:unknown={})=>page.evaluate(({action,input})=>(window as any).cbim.call(action,input),{action,input});
    const seeded=await seedKnowledgeSource(call,temp,probe.url,true),snapshot=await call('snapshot',{id:seeded.entry.id});
    const member=await call('workspace.members.get',{workspaceId:seeded.entry.id,instanceId:snapshot.instanceId,memberId:seeded.registered.receipt.memberId});
    const ownership=await call('workspace.ownerships.get',{workspaceId:seeded.entry.id,instanceId:snapshot.instanceId,moduleId:seeded.assigned.receipt.moduleId});
    assert.ok(member.member.adoption);assert.equal(member.member.adoption.sourceRef,undefined);assert.equal(ownership.view.binding.sourceRef,undefined);
    assert.deepEqual(await call('loop.list',{id:seeded.entry.id}),[]);assert.deepEqual(probe.requests,[]);assert.deepEqual(errors,[]);
    await desktop.close();desktop=undefined;const disk=await knowledgeSourceDiskEvidence(user,seeded.entry.id);
    const evidence={kind:'actual-pre-source-EXE-fixture',executable,temp,user,seeded,snapshot,member,ownership,modelHttpRequests:0,pageErrors:errors,dispatchSha256:createHash('sha256').update(disk.dispatchBytes).digest('hex'),journalHashes:disk.journals.map(item=>({name:item.name,sha256:item.sha256})),createdThrough:'real desktop IPC actions against fixed Step31 executable; no production test hook'};
    return {temp,user,seeded,probe,disk,evidence,cleanup:async(remove=false)=>{await probe.close();if(remove){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-source-legacy-'));assert.equal((await fs.lstat(target)).isSymbolicLink(),false);await fs.rm(target,{recursive:true,force:true})}}};
  }catch(error){if(desktop)await desktop.close();await probe.close();await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/knowledge-source-legacy-seed-failure.json',JSON.stringify({executable,temp,user,error:String(error),pageErrors:errors,modelHttpRequests:probe.requests.length,retained:true},null,2));throw error}
}
