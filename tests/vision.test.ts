import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {fixture} from './helpers';
import {ChatInputs} from '../src/backend/main/persistence/tasks/chat-inputs';
import {parseModelCatalog} from '../src/backend/core/brain/llm/catalog';
import {modelSchema} from '../src/backend/core/brain/llm/config';
import {MessageQueue} from '../src/backend/scheduler-engine/conversation/message-queue';

// Generate a valid 2x2 RGB PNG with real CRCs, so Pi's decoder is exercised too.
function chunk(type:string,data:Buffer){const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,content,tail])}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,255,0,0,0,0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
it('image capability is explicit, discoverable, and backward compatible',()=>{
 expect(parseModelCatalog([{id:'unknown'},{id:'vision',input:['text','image']},{id:'plain',architecture:{input_modalities:['text']}},{id:'explicit',vision:false,input:['image']}]).map(m=>m.vision)).toEqual([undefined,true,false,false]);
 expect(modelSchema.parse({id:'legacy',name:'legacy',enabled:true,contextWindow:8192,maxTokens:1024,reasoning:false}).vision).toBeUndefined();
});
it('image snapshots preserve bytes, isolate workspaces, limit size, and survive queue reload',async()=>{
 const f=await fixture();try{
  const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});const inputs=new ChatInputs(f.app.workspace(a.id));
  const file=path.join(f.a,'picture.bin');await fs.writeFile(file,Buffer.from(png,'base64'));const item=await inputs.path('file',file);await fs.writeFile(file,'changed');
  expect(await inputs.images([item.id])).toEqual([{type:'image',mimeType:'image/png',data:png}]);
  expect(await inputs.message('look',[item.id])).not.toContain(png);
  await expect(new ChatInputs(f.app.workspace(b.id)).images([item.id])).rejects.toThrow();
  await expect(inputs.images(['../invalid'])).rejects.toThrow();
  const big=Buffer.alloc(5*1024*1024+1);Buffer.from(png,'base64').copy(big);await fs.writeFile(file,big);await expect(inputs.path('file',file)).rejects.toThrow('5 MiB');
  const qfile=path.join(f.a,'queue.json'),queue=new MessageQueue(qfile);await queue.add('conversation','look',{provider:'p',model:'m',attachmentIds:[item.id]});const restored=new MessageQueue(qfile);await restored.load();expect(restored.list('conversation')[0].options.attachmentIds).toEqual([item.id]);
 }finally{await f.cleanup()}
});
it('real Pi sends attachment image bytes to the provider, preserves them on resume, and rejects text-only models',async()=>{
 const f=await fixture();const requests:any[]=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const data={id:'vision-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:'Image received.'},finish_reason:'stop'}]};
  res.end('data: '+JSON.stringify(data)+'\n\ndata: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const entry=await f.app.dispatch('add',{path:f.a});const inputs=new ChatInputs(f.app.workspace(entry.id));const file=path.join(f.a,'pixel.png');await fs.writeFile(file,Buffer.from(png,'base64'));const attachment=await inputs.path('file',file);
  const models=['vision','plain'].map(id=>({id,name:id,enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,vision:id==='vision'}));
  const saved=await f.app.models.save({profile:{name:'local vision test',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',models,defaultModel:'vision'}});
  const options={profileId:saved.selectedId,model:'vision',permission:'read'};
  await expect(f.app.dispatch('loop.chat',{id:entry.id,message:'look',attachments:[attachment.id],options:{...options,model:'plain'}})).rejects.toThrow('图片输入');expect(requests).toHaveLength(0);
  const wait=async(taskId:string,runId:string)=>{let result=await f.app.execution(entry.id).inspect(taskId,runId);while(result.status==='running'){await new Promise(r=>setTimeout(r,20));result=await f.app.execution(entry.id).inspect(taskId,runId)}return result};
  const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'look',attachments:[attachment.id],options});const result=await wait(first.taskId,first.runId);expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
  const images=(body:any)=>body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((c:any)=>c.type==='image_url'):[]);
  expect(images(requests[0]),JSON.stringify(requests[0].messages.filter((m:any)=>m.role==='user'))).toEqual([expect.objectContaining({image_url:expect.objectContaining({url:'data:image/png;base64,'+png})})]);
  const config=JSON.parse(await fs.readFile(path.join(f.app.paths.project(entry.id),'loop-engine','tasks',first.taskId,first.runId,'provider','models.json'),'utf8'));expect(Object.values<any>(config.providers)[0].models[0].input).toEqual(['text','image']);
  expect(JSON.stringify(result.events)).not.toContain(png);
  const second=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'summarize',options});expect((await wait(first.taskId,second.runId)).status).toBe('completed');expect(images(requests[1])).toHaveLength(1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},60000);
