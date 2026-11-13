import fs from 'node:fs/promises';import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import type {ExecutionScope} from '../src/logic/workspace/rules/execution-scope';
import {seedTeam} from './team-fixture';import {request} from './data/knowledge';import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {scopedData} from './scoped-execution-provider';
export {workflowConditionRecords as scopedRecords,workflowConditionLogBytes as scopedLogBytes} from './workflow-condition-fixture';
export async function seedScopedExecution(app:Application,project:string,providerUrl:string,mode:'complete'|'stop'='complete'){
 const models=await app.models.save({profile:{name:'Scoped fixture',api:'openai-completions',baseUrl:providerUrl,auth:'none',defaultModel:scopedData.model,models:[{id:scopedData.model,name:'Scoped fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(p=>p.name==='Scoped fixture')!;
 const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(f=>f.path===modulePath)!.text);
 definition.maintenance={bindingId:'scope-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'scope-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
 const executionScope:ExecutionScope={version:1,profile:'windows-lpac-node-v1',read:[{path:'src',kind:'directory'},{path:scopedData.file,kind:'file'}],write:[{path:scopedData.file,kind:'file'}],node:{timeoutMs:mode==='stop'?30000:5000,memoryMiB:512,processLimit:2}};
 const contract={version:1,executionScope,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-final',toolName:'cbim_scoped_read'}]}},text='# 冻结范围执行\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
 await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:team.input.workflowId+'/workflow.md',text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
 const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:scopedData.model,name:'范围执行岗位'});
 await fs.mkdir(path.join(project,'src'));await fs.writeFile(path.join(project,scopedData.file),scopedData.before);await fs.writeFile(path.join(project,'private.txt'),'PRIVATE_SENTINEL');await fs.writeFile(path.join(project,'src','data.txt'),scopedData.after);
 const script=mode==='stop'?"const c=require('child_process').spawn(process.execPath,[...(process.versions.electron?['--no-stdio-init']:[]),'-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('ready.json',JSON.stringify({pid:process.pid,child:c.pid}));console.log(c.pid);setInterval(()=>{},1000)":"const fs=require('fs'),path=require('path');try{fs.readFileSync("+JSON.stringify(path.join(project,'private.txt'))+");process.exit(3)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}fs.writeFileSync('out.txt',fs.readFileSync(path.join(__dirname,'data.txt')));";
 await fs.writeFile(path.join(project,'src','main.cjs'),script);return {entry,agentId:team.input.agentId,moduleId:team.input.moduleId,selection:owner.selection,contract};
}
