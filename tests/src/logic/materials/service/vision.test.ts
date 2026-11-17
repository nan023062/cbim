// logic/materials/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
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
it('image snapshots preserve bytes, isolate workspaces, limit size, and survive queue reload',async()=>{
 const f=await fixture();try{
  const a=await f.app.Dispatch('add',{path:f.a}),b=await f.app.Dispatch('add',{path:f.b});const inputs=new ChatInputs(f.app.Workspace(a.id));
  const file=path.join(f.a,'picture.bin');await fs.writeFile(file,Buffer.from(png,'base64'));const item=await inputs.Path('file',file);await fs.writeFile(file,'changed');
  expect(await inputs.Images([item.id])).toEqual([{type:'image',mimeType:'image/png',data:png}]);
  expect(await inputs.Message('look',[item.id])).not.toContain(png);
  await expect(new ChatInputs(f.app.Workspace(b.id)).Images([item.id])).rejects.toThrow();
  await expect(inputs.Images(['../invalid'])).rejects.toThrow();
  const big=Buffer.alloc(5*1024*1024+1);Buffer.from(png,'base64').copy(big);await fs.writeFile(file,big);await expect(inputs.Path('file',file)).rejects.toThrow('5 MiB');
  const qfile=path.join(f.a,'queue.json'),queue=new MessageQueue(qfile);await queue.Add('conversation','look',{provider:'p',model:'m',attachmentIds:[item.id]});const restored=new MessageQueue(qfile);await restored.Load();expect(restored.List('conversation')[0].options.attachmentIds).toEqual([item.id]);
 }finally{await f.cleanup()}
});
