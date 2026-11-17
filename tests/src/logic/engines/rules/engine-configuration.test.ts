// logic/engines/rules: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LlmProfiles} from '../../../../../src/logic/models/service/index';
import {EngineModelProfiles,type LockedEngineModelConfiguration} from '../../../../../src/logic/engines/service/index';
import {definition,type LlmDefinition,type LlmProfile} from '../../../../../src/logic/models/index';
import {engineSupportsApi,loopEngineSchema} from '../../../../../src/logic/engines/index';
import {workspaceMemberModelHash} from '../../../../../src/logic/team/rules/workspace-member-rules';
import {workspaceMemberModelSnapshotSchema} from '../../../../../src/logic/team/rules/workspace-member';
import {objectOperation} from '../../../../../src/logic/knowledge/rules/object-crud';
import {queuedMessageSchema} from '../../../../../src/logic/tasks/rules/queue';
import {EngineModelPicker} from '../../../../../src/view/components/EngineModelPicker';

const base:LlmDefinition={name:'Shared provider',api:'anthropic-messages',auth:'none',baseUrl:'http://127.0.0.1:1',defaultModel:'test',models:[{id:'test',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-config-'));const profiles=new LlmProfiles(path.join(root,'models.json'));return {profiles,models:new EngineModelProfiles(profiles),filename:path.join(root,'models.json'),cleanup:async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-engine-config-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}}}

test.each([
  ['openai-completions',['pi','memory']],['anthropic-messages',['pi','claude-code']],['openai-responses',['pi','codex']],['unknown',[]],
])('主模型协议 %s 只映射到声明支持的引擎，额外必填角色另行校验', (api,expected)=>{
  expect(loopEngineSchema.options.filter(engine=>engineSupportsApi(engine,api as string))).toEqual(expected);
});
