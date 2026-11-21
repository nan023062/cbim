import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OfficeInputs } from '../../../../../src/logic/projects/office-inputs';

const fixture=vi.hoisted(()=>({context:null as any,options:null as any,run:null as any,steer:undefined as any,closed:0}));
vi.mock('../../../../../src/logic/projects/office-engine-loader',()=>({packagedEngineAdapter:()=>({create:(options:any)=>{fixture.options=options;return {start:async(context:any)=>{fixture.context=context;},run:(goal:string)=>fixture.run(goal),steer:fixture.steer,stop:async()=>{},close:async()=>{fixture.closed++;}};}})}));
vi.mock('../../../../../src/logic/engines/service',()=>({EngineModelProfiles:class{async Resolve(){return {profile:{id:'p',model:'m',contextWindow:1000}};}}}));
import { runOfficePlugin } from '../../../../../src/bridge/server/desktop/office-plugin';

test('真实 Office 宿主在工具执行前交付变化并阻止旧调用，工具返回同时携带新补充',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-input-host-'));const inputs=new OfficeInputs();fixture.closed=0;fixture.steer=undefined;
 const releases=vi.fn();const packages={Check:async()=>{},List:async()=>[{kind:'codex',enabled:true,active:{identity:'test'},candidate:{identity:'test'}}],ResolveEngine:async()=>({identity:'test',retain:()=>releases})};
 let inspections=0;
 fixture.run=async()=>{inputs.Push('架构已变更');const denied=await fixture.context.beforeTool({id:'old',name:'cbim_office_inspect',input:{}});expect(denied.allow).toBe(false);expect(denied.reason).toContain('架构已变更');expect(inspections).toBe(0);expect((await fixture.context.beforeTool({id:'new',name:'cbim_office_inspect',input:{}})).allow).toBe(true);const result=await fixture.options.knowledge.call('cbim_office_inspect',{},new AbortController().signal,'new');expect(result.officeInputs[0].text).toBe('执行期间的新任务');expect(result.toolResult).toBeDefined();await fixture.context.emit({type:'message',data:{role:'assistant',text:'应用了更新'}});return {status:'completed'};};
 try{const result=await runOfficePlugin(packages as any,{} as any,'instructions',[{role:'user',content:'原任务'}],new AbortController().signal,()=>{},{inputs,ReadPermission:()=> 'read',ReportTokens:()=>{},operations:{Inspect:()=>{inspections++;inputs.Push('执行期间的新任务');return {ok:true};},Dispatch:async()=>({})},selection:{engine:'codex',profileId:'p',modelId:'m'},root,session:'s',project:'p',dataRoot:root});expect(result.text).toBe('应用了更新');expect(inspections).toBe(1);expect(fixture.closed).toBe(1);expect(releases).toHaveBeenCalledOnce();expect(inputs.Finish()).toEqual([]);}
 finally{await fs.rm(root,{recursive:true,force:true});}
});

test('支持 steer 的引擎通过同一队列收到运行中输入，关闭前等待交付回执',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-native-input-'));const inputs=new OfficeInputs();let delivered='';fixture.closed=0;
 fixture.steer=async(text:string)=>{await new Promise(resolve=>setTimeout(resolve,5));delivered=text;};
 fixture.run=async()=>{await new Promise(resolve=>setTimeout(resolve,0));inputs.Push('插入本轮');await new Promise(resolve=>setTimeout(resolve,0));await fixture.context.emit({type:'message',data:{role:'assistant',text:'done'}});return {status:'completed'};};
 const packages={Check:async()=>{},List:async()=>[{kind:'pi',enabled:true,active:{identity:'test'},candidate:{identity:'test'}}],ResolveEngine:async()=>({identity:'test'})};
 try{await runOfficePlugin(packages as any,{} as any,'instructions',[{role:'user',content:'原任务'}],new AbortController().signal,()=>{},{inputs,ReadPermission:()=> 'read',ReportTokens:()=>{},operations:{Inspect:()=>({}),Dispatch:async()=>({})},selection:{engine:'pi',profileId:'p',modelId:'m'},root,session:'s',project:'p',dataRoot:root});expect(JSON.parse(delivered).officeInput.text).toBe('插入本轮');expect(inputs.Finish()).toEqual([]);expect(fixture.closed).toBe(1);}
 finally{await fs.rm(root,{recursive:true,force:true});}
});
