// logic/conversation/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {fixture} from '../../application/support/helpers';
import {ChatInputs} from '../../../../../src/logic/materials/service/chat-inputs';
import {parseModelCatalog} from '../../../../../src/logic/models/index';
import {modelSchema} from '../../../../../src/logic/models/index';
import {MessageQueue} from '../../../../../src/logic/conversation/runtime/message-queue';
import type {RunSummary} from '../../../../../src/logic/execution/rules/types';

// Generate a valid 2x2 RGB PNG with real CRCs, so Pi's decoder is exercised too.
function chunk(type:string,data:Buffer){const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,content,tail])}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,255,0,0,0,0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
it('real Pi sends attachment image bytes to the provider, preserves them on resume, and rejects text-only models',async()=>{
 const f=await fixture();const requests:any[]=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const data={id:'vision-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:'Image received.'},finish_reason:'stop'}]};
  res.end('data: '+JSON.stringify(data)+'\n\ndata: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const entry=await f.app.Dispatch('add',{path:f.a});const inputs=new ChatInputs(f.app.Workspace(entry.id));const file=path.join(f.a,'pixel.png');await fs.writeFile(file,Buffer.from(png,'base64'));const attachment=await inputs.Path('file',file);
  const models=['vision','plain'].map(id=>({id,name:id,enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,vision:id==='vision'}));
  const saved=await f.app.models.Save({profile:{name:'local vision test',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',models,defaultModel:'vision'}});
  const options={profileId:saved.selectedId,model:'vision',permission:'read'};
  await expect(f.app.Dispatch('loop.chat',{id:entry.id,message:'look',attachments:[attachment.id],options:{...options,model:'plain'}})).rejects.toThrow('图片输入');expect(requests).toHaveLength(0);
  // A completed model run can still be closing its dispatch scope; queued receipts point to the old run, not the upcoming one.
  const wait=async(receipt:{taskId:string;runId:string;queued?:boolean})=>{let result:RunSummary|undefined;await vi.waitFor(async()=>{const history=await f.app.Execution(entry.id).Thread(receipt.taskId);result=history.at(-1);expect(result).toBeDefined();if(receipt.queued)expect(result!.runId).not.toBe(receipt.runId);else expect(result!.runId).toBe(receipt.runId);expect(result!.status).not.toBe('running');expect((f.app.Execution(entry.id) as any).active.has(receipt.taskId)).toBe(false)},{timeout:20000,interval:20});return result!};
  const first=await f.app.Dispatch('loop.chat',{id:entry.id,message:'look',attachments:[attachment.id],options});const result=await wait(first);expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
  const images=(body:any)=>body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((c:any)=>c.type==='image_url'):[]);
  expect(images(requests[0]),JSON.stringify(requests[0].messages.filter((m:any)=>m.role==='user'))).toEqual([expect.objectContaining({image_url:expect.objectContaining({url:'data:image/png;base64,'+png})})]);
  const config=JSON.parse(await fs.readFile(path.join(f.app.paths.Project(entry.id),'loop-engine','tasks',first.taskId,first.runId,'provider','models.json'),'utf8'));expect(Object.values<any>(config.providers)[0].models[0].input).toEqual(['text','image']);
  expect(JSON.stringify(result.events)).not.toContain(png);
  const second=await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'summarize',options});const resumed=await wait(second);expect(resumed.status,JSON.stringify(resumed.events.at(-1))).toBe('completed');expect(resumed.runId).not.toBe(first.runId);expect(requests).toHaveLength(2);expect(images(requests[1])).toHaveLength(1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},60000);
