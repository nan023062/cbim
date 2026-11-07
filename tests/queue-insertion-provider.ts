import assert from 'node:assert/strict';
import http from 'node:http';

export const insertionData={model:'queue-insertion-fixture',otherModel:'queue-only-different-model',goal:'QUEUE_BOUND_MAIN：先核实原文件，再处理本轮补充',insert:'QUEUE_INSERTED_ONLY_ONCE：按补充格式解释原文件',fresh:'QUEUE_FRESH_MAIN：停止之后显式开始的新目标',fact:'QUEUE_ORIGINAL_TOOL_FACT_4c11ad',draft:'普通草稿：不得被插入或停止清除'};
export interface InsertionRequest{model:string;messages:Array<{role:string;content:unknown}>;tools?:Array<{function:{name:string}}>}
/** 只有响应内容及两个响应窗口可控；原生 steer、文件 read、队列与运行全部来自真实 Pi。 */
export async function insertionProvider(){
  const requests:InsertionRequest[]=[],errors:string[]=[];let firstRelease!:()=>void,freshRelease!:()=>void;
  const first=new Promise<void>(resolve=>firstRelease=resolve),fresh=new Promise<void>(resolve=>freshRelease=resolve);let earlyClosed=0;
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw) as InsertionRequest,index=requests.length;requests.push(body);
    res.on('close',()=>{if(!res.writableEnded)earlyClosed++});
    const isFresh=JSON.stringify(body.messages.at(-1)).includes(insertionData.fresh);
    if(index===0)await first;else if(isFresh)await fresh;
    if(res.destroyed)return;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'queue-insertion-'+index,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(index===0){emit({role:'assistant',tool_calls:[{index:0,id:'queue-original-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'queue-original.txt'})}}]});emit({},'tool_calls')}
    else{if(!isFresh){assert.ok(JSON.stringify(body.messages).includes(insertionData.fact));assert.ok(JSON.stringify(body.messages).includes(insertionData.insert))}emit({role:'assistant',content:isFresh?'显式新目标已完成；没有接收旧插入。':'原读取已完成，已按本轮补充解释；没有升级权限。'});emit({},'stop')}
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('queue insertion fixture failure')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,requests,errors,get earlyClosed(){return earlyClosed},release:firstRelease,releaseFresh:freshRelease,close:async()=>{firstRelease();freshRelease();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
