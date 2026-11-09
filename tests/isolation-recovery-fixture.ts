import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID,randomBytes} from 'node:crypto';import {createRequire} from 'node:module';
import {Win32IsolationRecovery} from '../src/backend/main/platform/isolation-recovery-win32';
import type {IsolationRecord,IsolationResource} from '../src/backend/main/platform/isolation-record';
import {artifactBinding} from './artifact-runtime-fixture';import {hash} from '../src/backend/core/foundation/serialization';
export const isolationPlatform=()=>new Win32IsolationRecovery(createRequire(import.meta.url).resolve('koffi'));
export async function isolationFixture(){
 const temp=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(temp,'cbim-isolated-')),data=await fs.mkdtemp(path.join(temp,'cbim-isolation-records-')),platform=isolationPlatform(),executionId=randomUUID(),host=platform.processIdentity();
 const resource:IsolationResource={executionId,profileName:'CBIM.Isolated.'+executionId,jobName:'Local\\CBIM.Isolated.'+executionId,root,rootIdentity:platform.directoryIdentity(root),nonce:randomBytes(32).toString('hex'),host};
 await fs.writeFile(path.join(root,'owner.json'),JSON.stringify({executionId,profileName:resource.profileName,pid:host.pid,nonce:resource.nonce}));await fs.mkdir(path.join(root,'output'));await fs.writeFile(path.join(root,'output','keep.txt'),'owned bytes');
 const record:IsolationRecord={version:1,origin:{binding:{...artifactBinding,workspaceId:hash('workspace')},workspaceInstanceId:randomUUID(),scopeId:'scope',scopeHash:hash('scope'),toolCallId:'node',inputHash:hash('input'),allowedSeq:2,permission:'execute'},resource,requestHash:hash('request'),createdAt:new Date().toISOString()};
 return {root,data,platform,resource,record,remove:async()=>{for(const target of [root,data]){if(path.dirname(path.resolve(target))!==temp||!/^cbim-isolat(ed|ion-records)-[A-Za-z0-9]+$/.test(path.basename(target)))throw Error('cleanup');await fs.rm(target,{recursive:true,force:true})}}};
}
