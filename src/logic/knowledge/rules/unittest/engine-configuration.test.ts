// logic/knowledge/rules: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../../../models/service/index';
import {EngineModelProfiles,type LockedEngineModelConfiguration} from '../../../engines/service/index';
import {definition,type LlmDefinition,type LlmProfile} from '../../../models/index';
import {engineSupportsApi,loopEngineSchema} from '../../../engines/index';
import {workspaceMemberModelHash} from '../../../team/rules/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../../../team/rules/workspace-member';
import {objectOperation} from '../object-crud';
import {queuedMessageSchema} from '../../../tasks/rules/queue';
import {EngineModelPicker} from '../../../../view/components/EngineModelPicker';

const base:LlmDefinition={name:'Shared provider',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));const profiles=new LlmProfiles(path.join(root,'models.json'));return {profiles,models:new EngineModelProfiles(profiles),filename:path.join(root,'models.json'),cleanup:async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}}}

test.each(['claude-code','codex'] as const)('Agent 与已排队消息各自冻结 %s 引擎，不从供应商推断',engine=>{
  const runtime={engine,profileId:randomUUID(),modelId:'test'};
  expect(objectOperation.parse({kind:'agent',action:'update',id:'.cbim/team/test',data:{runtime}}).data).toEqual({runtime});
  expect(objectOperation.safeParse({kind:'module',action:'update',id:'.cbim/workspace/test',data:{runtime}}).success).toBe(false);
  expect(queuedMessageSchema.parse({id:randomUUID(),taskId:randomUUID(),message:'test',status:'pending',options:{engine,provider:'cbim-'+runtime.profileId,profileId:runtime.profileId,model:'test'}}).options.engine).toBe(engine);
});
