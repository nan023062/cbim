import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';

// Shared by the runtime and resource smoke tests. Only the localhost provider is deterministic:
// registration, ownership, goal planning, cancellation and persistence use the packaged application's public entry points.
export async function pollDesktop(read,accept,label){
  const deadline=Date.now()+30000;
  let value=await read();
  while(!accept(value)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,80));value=await read()}
  assert.ok(accept(value),label+': '+JSON.stringify(value));return value;
}

function toolResult(body,id){
  const message=body.messages.find(item=>item.role==='tool'&&item.tool_call_id===id);
  assert.ok(message,'Missing real tool response: '+id);
  const text=typeof message.content==='string'?message.content:message.content.map(item=>item.text??'').join('');
  let result=JSON.parse(text);
  if(Array.isArray(result.content))result=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join(''));
  return result;
}

/** Hold the main request after real owner discovery and goal planning, so queued members cannot be claimed yet. */
export async function desktopDispatchFixture(call){
  const cases=[],errors=[];
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);
      assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task'),'Unexpected member/model execution');
      const scenario=cases.find(item=>body.messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes(item.marker)));
      assert.ok(scenario,'Unexpected main request');
      const turn=scenario.requests++;
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id,name,args)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');res.end('data: [DONE]\n\n')};
      if(turn===0)tool('inspect-owner','cbim_module_owner_inspect',{moduleIds:scenario.moduleIds});
      else if(turn===1){
        const discovery=toolResult(body,'inspect-owner').execution;
        assert.equal(discovery.groups.length,1);
        const group=discovery.groups[0];assert.deepEqual(group.issues,[]);assert.ok(group.selection);
        assert.equal(group.agentId,scenario.agentId);assert.equal(group.memberId,scenario.memberId);
        scenario.ownerSelection=group.selection;
        tool('plan-goal','cbim_goal_plan',{expectedRevision:1,objective:scenario.objective,constraints:['Only inspect this isolated smoke fixture'],criteria:[{id:'verify',text:'Provide actual verification evidence',kind:'evidence'}],assignments:[{agentId:scenario.agentId,moduleIds:scenario.moduleIds,ownerSelection:group.selection,criterionIds:['verify'],reason:'Explicitly registered fixture owner'}],reason:'Plan before dispatch'});
      }else if(turn===2){
        const result=toolResult(body,'plan-goal');
        assert.ok(result.goal?.plan,'Goal planning failed: '+JSON.stringify(result));
        scenario.scopeId=result.scopeId;
        emit({role:'assistant',content:'Smoke fixture: main request remains active until explicitly stopped.'});
        scenario.ready=true;
        // Deliberately leave only this local response pending. App stop/close must cancel it;
        // never finish the main turn and accidentally trigger member execution during static UI tests.
      }else throw Error('Unexpected extra model request: '+turn);
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const close=async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
  try{
    const settings=await call('models.save',{profile:{name:'Isolated desktop dispatch smoke',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'desktop-smoke',models:[{id:'desktop-smoke',name:'Desktop smoke',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const profileId=settings.profiles.find(profile=>profile.name==='Isolated desktop dispatch smoke').id;
    return {
      async register(workspaceId,agentId,moduleIds){
        const snapshot=await call('snapshot',{id:workspaceId}),identity={workspaceId,instanceId:snapshot.instanceId};
        const change={kind:'register',agentId,name:'Desktop smoke owner',position:'Verify isolated smoke modules',adaptation:{instructions:'Keep the test scope and real evidence requirements',references:moduleIds},runtimePolicy:{profileId,modelId:'desktop-smoke'},reason:'Explicit test owner, not inferred from static definitions'};
        const preview=await call('workspace.members.preview',{...identity,change});
        const receipt=await call('workspace.members.commit',{...identity,change,commandId:randomUUID(),expectedRegistryCursor:preview.registryCursor,expectedBasis:preview.basis});
        const detail=await call('workspace.members.get',{...identity,memberId:receipt.memberId});
        assert.equal(detail.sourceStatus.status,'current');
        for(const moduleId of moduleIds){
          const {view}=await call('workspace.ownerships.get',{...identity,moduleId});
          assert.ok(!view.binding?.ownerMemberId,'Do not replace an existing owner');
          const binding=view.binding;
          const change={moduleId,expectedBinding:binding?{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId}:null,nextOwner:{memberId:detail.member.memberId,expectedRevision:detail.member.revision},reason:'Explicit module responsibility for the isolated fixture'};
          const preview=await call('workspace.ownerships.preview',{...identity,change});
          await call('workspace.ownerships.commit',{...identity,change,commandId:randomUUID(),expectedOwnershipCursor:preview.ownershipCursor,expectedBasis:preview.basis});
          assert.equal((await call('workspace.ownerships.get',{...identity,moduleId})).view.binding.ownerMemberId,detail.member.memberId);
        }
        return {workspaceId,agentId,moduleIds,memberId:detail.member.memberId};
      },
      async plan(owner,objective){
        const scenario={...owner,objective,marker:'SMOKE_SCOPE_'+randomUUID(),requests:0,ready:false};cases.push(scenario);
        const run=await call('loop.chat',{id:owner.workspaceId,message:scenario.marker+' '+objective,options:{engine:'pi',provider:'cbim-'+profileId,profileId,model:'desktop-smoke',permission:'read',collaborationMode:'team',turnTimeoutMs:240000}});
        await pollDesktop(async()=>{assert.deepEqual(errors,[]);return scenario.ready},Boolean,'Real owner discovery and goal plan');
        const identity={workspaceId:owner.workspaceId,rootSessionId:run.taskId};
        const read=await call('dispatch.sessionRead',{identity,selectedScopeId:scenario.scopeId});
        assert.equal(read.detail.mode,'updated');assert.equal(read.detail.scope.status,'active');
        assert.equal(read.detail.scope.goal.plan.objective,objective);
        return {identity,scopeId:scenario.scopeId,ownerSelection:scenario.ownerSelection,run};
      },
      evidence(){assert.deepEqual(errors,[]);assert.ok(cases.every(item=>item.ready&&item.requests===3));return {realProvider:false,modelCalls:cases.reduce((sum,item)=>sum+item.requests,0),scopes:cases.map(({scopeId,requests})=>({scopeId,requests})),transportErrors:errors}},
      close,
    };
  }catch(error){await close();throw error}
}
