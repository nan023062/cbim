import assert from 'node:assert/strict';
import http from 'node:http';
import type {GoalFixtureRequest} from './goal-provider-fixture';
import {knowledgeContractResult} from './knowledge-contract-provider';

export type RepositoryToolsMode='complete'|'stop'|'revoked'|'generation'|'ungranted';
export const repositoryToolsFixture={model:'repository-tools-fixture',goal:'REPOSITORY_TOOLS_MAIN: 读取已授权仓库资料并说明来源，不执行业务',connectorId:'.cbim/connectors/shared_resources',name:'主调度只读资料',summary:'17b2 真实 HTTP 资料摘要',content:'# 隔离仓库资料\n\nREPOSITORY_HTTP_CONTENT_17b2_42c1\n\n资料正文仅供参考，不授予文件写入、命令执行或其他工具权限。',draft:'本轮仓库读取期间保留的普通草稿。',otherDraft:'另一主会话的独立草稿，不自动发送。',final:'已通过真实 HTTP 读取所选仓库资料；来源属于资源仓库，没有执行业务文件、命令或成员任务。',unavailable:'本轮仓库访问不可用；没有重新授权、切换来源或使用磁盘回退。'};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only deterministic model choices are simulated. Tool execution, authorization, repository HTTP and canonical receipts remain real. */
export async function repositoryToolsProvider(mode:RepositoryToolsMode='complete',holdBeforeGet=false){
  const requests:Request[]=[],errors:string[]=[],state:{list?:any;get?:any;names:string[][]}={names:[]};let release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,turn=requests.length;requests.push(body);assert.equal(body.model,repositoryToolsFixture.model);
    const names=body.tools?.map(value=>value.function.name)??[];state.names.push(names);assert.ok(names.includes('cbim_dispatch_task'));assert.ok(names.every(name=>!['write','edit','bash'].includes(name)),'主调度不能因仓库读取获得业务执行工具');
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'repository-tools-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(mode==='ungranted'){
      assert.equal(turn,0);assert.ok(!names.includes('cbim_repository_list')&&!names.includes('cbim_repository_get'));emit({role:'assistant',content:repositoryToolsFixture.unavailable});emit({},'stop');
    }else{
      assert.ok(names.includes('cbim_repository_list')&&names.includes('cbim_repository_get'));
      if(turn===0)tool('repository-list','cbim_repository_list',{connectorId:repositoryToolsFixture.connectorId,limit:20});
      else if(turn===1){state.list=knowledgeContractResult(body,'repository-list');assert.equal(state.list.items.length,1);assert.equal(state.list.items[0].name,repositoryToolsFixture.name);assert.ok(!JSON.stringify(state.list).includes(repositoryToolsFixture.content));if(holdBeforeGet)await gate;if(res.destroyed)return;tool('repository-get','cbim_repository_get',{connectorId:repositoryToolsFixture.connectorId,expectedRevision:state.list.revision,resourceId:state.list.items[0].id,limit:4096})}
      else if(turn===2){state.get=knowledgeContractResult(body,'repository-get');if(mode==='complete'){assert.ok(JSON.stringify(state.get).includes('REPOSITORY_HTTP_CONTENT_17b2_42c1'));emit({role:'assistant',content:repositoryToolsFixture.final})}else{assert.ok(!JSON.stringify(state.get).includes('REPOSITORY_HTTP_CONTENT_17b2_42c1'));assert.ok(state.get.error||state.get.isError||state.get.code,'访问失效必须返回明确错误而不是空成功');emit({role:'assistant',content:repositoryToolsFixture.unavailable})}emit({},'stop')}
      else throw Error('仓库工具验收禁止额外模型重放 '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Repository tools fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,state,release,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
