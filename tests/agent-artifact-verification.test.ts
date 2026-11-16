import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {artifactRuntimeFixture,seedProgress,invoke,captureInput,artifactBinding} from './artifact-runtime-fixture';
import {AgentArtifactVerification} from '../src/logic/evidence/runtime/agent-artifact-verification';

it('checks real captured bytes, rejects changed files and leaves the original evidence untouched',async()=>{
 const f=await artifactRuntimeFixture(async c=>{await seedProgress(c);await invoke(c,'cbim_task_artifact_capture','capture',captureInput)});
 try{
  const summary=await(await f.start()).done,events=structuredClone(summary.events),signal=new AbortController().signal;
  const verify=()=>AgentArtifactVerification.verify(summary.events,artifactBinding,'knowledge-one',f.port.normalizePath,f.filePort.checkFiles.bind(f.filePort),signal);
  expect(await verify()).toMatchObject([{relativePath:'File.txt',byteLength:12}]);
  await fs.writeFile(path.join(f.directory,'File.txt'),'changed');
  await expect(verify()).rejects.toMatchObject({code:'ARTIFACT_BASELINE_STALE'});
  expect(summary.events).toEqual(events);
 }finally{await f.cleanup()}
});

it('rejects forged or invalidated captures before file IO; no capture does not invent file coverage',async()=>{
 const f=await artifactRuntimeFixture(async c=>{await seedProgress(c);await invoke(c,'cbim_task_artifact_capture','capture',captureInput)});
 try{
  const summary=await(await f.start()).done,check=vi.fn(f.filePort.checkFiles.bind(f.filePort)),signal=new AbortController().signal;
  const verify=(events=summary.events)=>AgentArtifactVerification.verify(events,artifactBinding,'knowledge-one',f.port.normalizePath,check,signal);
  const bad=structuredClone(summary.events);(bad.find(e=>e.type==='artifact.baseline_captured')!.data.baseline as any).files[0].sha256='0'.repeat(64);
  await expect(verify(bad)).rejects.toMatchObject({code:'ARTIFACT_EVIDENCE_INVALID'});expect(check).not.toHaveBeenCalled();
  const changed=structuredClone(summary.events);changed.push({...changed.at(-1)!,seq:changed.at(-1)!.seq+1,type:'tool.allowed',data:{id:'later-write',name:'write',effects:['business-write']}});
  await expect(verify(changed)).rejects.toMatchObject({code:'ARTIFACT_BASELINE_STALE'});expect(check).not.toHaveBeenCalled();
  expect(await verify([])).toEqual([]);expect(check).not.toHaveBeenCalled();
 }finally{await f.cleanup()}
});
