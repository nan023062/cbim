import assert from 'node:assert/strict';
import http from 'node:http';
import {moduleOwnerInspectOutputSchema,moduleOwnerPreviewOutputSchema,moduleOwnerRecordedOutputSchema} from '../src/logic/workspace/rules/module-ownership-tools';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {moduleOwnershipFixture as data} from './module-ownership-fixture';
import {workspaceMemberFixture} from './workspace-member-fixture';

export type ModuleOwnershipMode='read'|'ask-deny'|'ask-approve'|'execute'|'bad-wire'|'stop'|'member';
export const moduleOwnershipToolNames=['cbim_module_owner_inspect','cbim_module_owner_change_preview','cbim_module_owner_change_commit','cbim_module_owner_receipt'];
type OwnershipRequest=GoalFixtureRequest&{model:string;tools?:Array<{function:{name:string}}>};
function result(body:OwnershipRequest,id:string):any{
  const item=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(item,'Missing actual ownership tool response '+id);
  const text=typeof item.content==='string'?item.content:Array.isArray(item.content)?item.content.map(value=>value&&typeof value==='object'&&'text'in value?String(value.text):'').join(''):'';
  const parse=(value:string)=>{try{return JSON.parse(value)}catch{return {error:value}}};let parsed=parse(text);if(Array.isArray(parsed.content))parsed=parse(parsed.content.filter((value:{type:string})=>value.type==='text').map((value:{text:string})=>value.text).join(''));return parsed;
}

/** Deterministic local provider only chooses calls. Position UUIDs are discovered from the actual tool, never injected into model messages. */
export async function moduleOwnershipProvider(mode:ModuleOwnershipMode){
  const requests:OwnershipRequest[]=[],errors:string[]=[],state:Record<string,any>={};let moduleId='',release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as OwnershipRequest,turn=requests.length;requests.push(body);assert.equal(body.model,data.model);
    const names=body.tools?.map(tool=>tool.function.name)??[];if(mode==='member')assert.ok(moduleOwnershipToolNames.every(name=>!names.includes(name)));else{assert.ok(moduleOwnershipToolNames.every(name=>names.includes(name)));assert.ok(['write','edit','bash'].every(name=>names.includes(name)===(mode!=='read')))}
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'ownership-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const done=()=>{emit({role:'assistant',content:data.final});emit({},'stop')};
    if(mode==='member'){assert.equal(turn,0);done()}
    else if(turn===0)tool('owner-members','cbim_module_owner_inspect',{members:true,limit:20});
    else if(turn===1){
      const discovered=moduleOwnerInspectOutputSchema.parse(result(body,'owner-members'));assert.ok('memberPage'in discovered);assert.equal(discovered.memberPage.total,2);state.discovered=discovered;
      const selected=discovered.memberPage.items.find(item=>item.name===workspaceMemberFixture.firstName);assert.ok(selected);assert.equal(selected.state,'active');state.selected=selected;
      tool('owner-inspect','cbim_module_owner_inspect',{moduleIds:[moduleId]});
    }else if(turn===2){
      const inspected=moduleOwnerInspectOutputSchema.parse(result(body,'owner-inspect'));assert.ok('page'in inspected);assert.equal(inspected.page.items.length,1);assert.equal(inspected.page.items[0].moduleId,moduleId);assert.equal(inspected.page.items[0].binding,null);state.inspected=inspected;
      state.change={moduleId,expectedBinding:null,nextOwner:{memberId:state.selected.memberId,expectedRevision:state.selected.revision},reason:data.reason};tool('owner-preview','cbim_module_owner_change_preview',{change:state.change});
    }else if(turn===3){
      state.preview=moduleOwnerPreviewOutputSchema.parse(result(body,'owner-preview'));assert.equal(state.preview.preview.impact.total,0);assert.deepEqual(state.preview.preview.change,state.change);state.readyToCommit=true;if(mode==='stop')await held;
      tool('owner-commit','cbim_module_owner_change_commit',{change:state.change,expectedOwnershipCursor:state.preview.preview.ownershipCursor,expectedBasis:state.preview.preview.basis});
    }else if(turn===4){
      state.commitReply=result(body,'owner-commit');
      if(mode==='read'||mode==='ask-deny'){assert.equal(typeof state.commitReply.message,'string');assert.equal(state.commitReply.retryable,false);assert.equal(state.commitReply.status,'rejected');done()}
      else{
        if(mode==='bad-wire'){assert.equal(state.commitReply.code,'TOOL_OUTPUT_INVALID');assert.equal(state.commitReply.retryable,false);const match=String(state.commitReply.error).match(/commandId=([a-f0-9-]{36})/);assert.ok(match,'Bad output must retain the actual command ID');state.commandId=match[1]}
        else{state.recorded=moduleOwnerRecordedOutputSchema.parse(state.commitReply);state.commandId=state.recorded.commandId;assert.equal(state.recorded.receipt.actor.kind,'main_agent');assert.equal(state.recorded.receipt.ownerMemberId,state.selected.memberId)}
        tool('owner-receipt','cbim_module_owner_receipt',{commandId:state.commandId});
      }
    }else if(turn===5&&mode!=='read'&&mode!=='ask-deny'){
      state.recovered=moduleOwnerRecordedOutputSchema.parse(result(body,'owner-receipt'));assert.equal(state.recovered.commandId,state.commandId);assert.equal(state.recovered.receipt.actor.kind,'main_agent');assert.equal(state.recovered.receipt.ownerMemberId,state.selected.memberId);if(state.recorded)assert.deepEqual(state.recovered,state.recorded);done();
    }else throw Error('Ownership fixture refuses automatic tool replay at request '+turn);
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Ownership fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,bindModule:(id:string)=>{moduleId=id},release,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
