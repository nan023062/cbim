import {expect,it,vi} from 'vitest';
import http from 'node:http';
import path from 'node:path';
import {fixture} from './helpers';
import {seedWorkspaceMembers,changeWorkspaceMemberCapability} from './workspace-member-fixture';
import {request} from './data/knowledge';
import {knowledgeContractResult} from './knowledge-contract-provider';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {memberToolChangeSchema} from '../src/logic/team/rules/workspace-member-tools';

it.each(['execute','read'] as const)('真实 Pi 主工具 %s 注册、采纳、更新、停用沿唯一岗位审计，恢复不重放',async permission=>{
 const f=await fixture(),errors:string[]=[],requests:any[]=[];let seeded:Awaited<ReturnType<typeof seedWorkspaceMembers>>,app=f.app,memberId='',commandId='';
 let change:Record<string,unknown>,preview:any;
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),turn=requests.length;requests.push(body);
  expect(body.tools.map((t:any)=>t.function.name)).toContain('cbim_member_change_commit');
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'member-'+turn,object:'chat.completion.chunk',created:1,model:'member-explicit-a',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const tool=(name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id:'call-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
  const result=()=>knowledgeContractResult(body,'call-'+(turn-1));
  if(turn===0){const {runtimePolicy:_,...registration}=seeded.register() as any;change=registration;tool('cbim_member_change_preview',{change})}
  else if(turn===1){preview=result();expect(preview.capabilityHash,JSON.stringify(preview)).toMatch(/^[a-f0-9]{64}$/);tool('cbim_member_change_commit',{change,expectedBasis:preview.basis,expectedRegistryCursor:preview.registryCursor})}
  else if(permission==='read'){emit({role:'assistant',content:'只读权限未登记岗位'});emit({},'stop')}
  else if(turn===2){const receipt=result();expect(receipt.status).toBe('recorded');memberId=receipt.receipt.memberId;await changeWorkspaceMemberCapability(app,seeded.entry.id,seeded.team.input.agentId,seeded.team.shared);tool('cbim_member_inspect',{memberId})}
  else if(turn===3){const detail=result().detail;expect(detail.currentDiff.capability.status).toBe('changed');expect(detail.repair).toContain('cbim_member_change_preview: adopt target=capability');change={kind:'adopt',memberId,expectedRevision:detail.revision,target:'capability',reason:'采纳真实能力变更'};tool('cbim_member_change_preview',{change})}
  else if(turn===4||turn===7||turn===10){preview=result();tool('cbim_member_change_commit',{change,expectedBasis:preview.basis,expectedRegistryCursor:preview.registryCursor})}
  else if(turn===5){expect(result().receipt.memberRevision).toBe(2);tool('cbim_member_inspect',{memberId})}
  else if(turn===6){const detail=result().detail;expect(detail.currentDiff.capability.status).toBe('same');change={kind:'update',memberId,expectedRevision:detail.revision,patch:{name:'由主工具修订的岗位'},reason:'更新岗位名称'};tool('cbim_member_change_preview',{change})}
  else if(turn===8){expect(result().receipt.memberRevision).toBe(3);tool('cbim_member_inspect',{memberId})}
  else if(turn===9){change={kind:'state',memberId,expectedRevision:result().detail.revision,nextState:'suspended',reason:'暂停新派发'};tool('cbim_member_change_preview',{change})}
  else if(turn===11){commandId=result().commandId;tool('cbim_member_receipt',{commandId})}
  else if(turn===12){expect(result()).toMatchObject({status:'recorded',commandId,receipt:{memberId,memberRevision:4}});emit({role:'assistant',content:'岗位治理完成，未启动成员执行。'});emit({},'stop')}
  else throw Error('unexpected model request');
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture error')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  seeded=await seedWorkspaceMembers(app,f.temp,`http://127.0.0.1:${(server.address() as any).port}/v1`);
  const workspace=app.workspace(seeded.entry.id),snapshot=await workspace.snapshot(),file=snapshot.files.find(f=>f.path===seeded.team.input.agentId+'/agent.json')!;
  await workspace.commit(request(snapshot,[{path:file.path,text:JSON.stringify({...JSON.parse(file.text),runtime:{engine:'pi',profileId:seeded.profileId,modelId:seeded.modelId}})}]));
  const started=await app.dispatch('loop.chat',{id:seeded.entry.id,message:'通过岗位工具登记并修订团队能力',options:{permission,turnTimeoutMs:60000}});
  await vi.waitFor(async()=>{expect((await app.dispatch('loop.inspect',{id:seeded.entry.id,taskId:started.taskId,runId:started.runId})).status).not.toBe('running')},{timeout:60000,interval:50});
  expect(errors).toEqual([]);
  expect((await app.dispatch('loop.inspect',{id:seeded.entry.id,taskId:started.taskId,runId:started.runId})).status).toBe('completed');
  const list=await app.workspaceMembers(seeded.entry.id).list({workspaceId:seeded.entry.id,instanceId:workspace.instanceId});
  expect(list.total).toBe(permission==='execute'?1:0);
  if(permission==='execute'){
   expect(list.items[0]).toMatchObject({memberId,revision:4,state:'suspended',name:'由主工具修订的岗位'});
   const receipt=await app.workspaceMembers(seeded.entry.id).mainReceipt(seeded.entry.id,commandId,started.taskId);
   await expect(app.workspaceMembers(seeded.entry.id).mainReceipt(seeded.entry.id,commandId,'other')).rejects.toMatchObject({code:'MEMBER_ACTOR'});
   const count=requests.length;await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
   expect(await app.workspaceMembers(seeded.entry.id).mainReceipt(seeded.entry.id,commandId,started.taskId)).toEqual(receipt);expect(requests).toHaveLength(count);
  }
 }finally{await app.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},90000);

it('主工具拒绝模型选型、模型采纳及伪造 actor 字段',()=>{
 expect(memberToolChangeSchema.safeParse({kind:'adopt',memberId:'11111111-1111-4111-8111-111111111111',expectedRevision:1,target:'model',reason:'unauthorized'}).success).toBe(false);
 expect(memberToolChangeSchema.safeParse({kind:'update',memberId:'11111111-1111-4111-8111-111111111111',expectedRevision:1,patch:{runtimePolicy:{profileId:'11111111-1111-4111-8111-111111111111',modelId:'model'}},reason:'unauthorized'}).success).toBe(false);
});
