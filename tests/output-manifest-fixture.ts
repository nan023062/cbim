import fs from 'node:fs/promises';
import path from 'node:path';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import {preparedArtifactScopes} from '../src/backend/core/workspace/artifact-scope';
import {verifyOutputManifests} from '../src/backend/core/evidence/output-manifest-evidence';
import {artifactRuntimeFixture,artifactBinding} from './artifact-runtime-fixture';

export const manifestContracts:WorkflowContractBinding[]=[{moduleId:'.cbim/workspace/module',workflowId:'.cbim/workspace/module/workflow.md',workflowVersion:'workflow-one',contract:{version:1,artifactScope:{version:1,roots:[{path:'File.txt',kind:'file'},{path:'outputs',kind:'directory'}]}}}];
export const manifestScopes=preparedArtifactScopes(manifestContracts);
export const manifestInput={expectedTaskProgressVersion:1};
export const verifyManifests=(events:Parameters<typeof verifyOutputManifests>[0])=>verifyOutputManifests(events,artifactBinding,'knowledge-one',manifestScopes);
export async function manifestFixture(work:Parameters<typeof artifactRuntimeFixture>[0],options:Parameters<typeof artifactRuntimeFixture>[1]={}){
  const f=await artifactRuntimeFixture(work,{workflowContracts:manifestContracts,describeTool:call=>({effects:call.name==='read'?['read']:call.name==='write'?['business-write']:['maintenance'],native:call.name==='read'||call.name==='write',contractVersion:1}),...options});
  await fs.mkdir(path.join(f.directory,'outputs','empty'),{recursive:true});await fs.writeFile(path.join(f.directory,'outputs','a.txt'),'complete output');return f;
}
