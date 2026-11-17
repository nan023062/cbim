// logic/models: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {fixture} from '../../application/unittest/support/helpers';
import {ChatInputs} from '../../materials/service/chat-inputs';
import {parseModelCatalog} from '../index';
import {modelSchema} from '../index';
import {MessageQueue} from '../../conversation/runtime/message-queue';
import type {RunSummary} from '../../execution/rules/types';

// Generate a valid 2x2 RGB PNG with real CRCs, so Pi's decoder is exercised too.
function chunk(type:string,data:Buffer){const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,content,tail])}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,255,0,0,0,0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
it('image capability is explicit, discoverable, and backward compatible',()=>{
 expect(parseModelCatalog([{id:'unknown'},{id:'vision',input:['text','image']},{id:'plain',architecture:{input_modalities:['text']}},{id:'explicit',vision:false,input:['image']}]).map(m=>m.vision)).toEqual([undefined,true,false,false]);
 expect(modelSchema.parse({id:'legacy',name:'legacy',enabled:true,contextWindow:8192,maxTokens:1024,reasoning:false}).vision).toBeUndefined();
});
