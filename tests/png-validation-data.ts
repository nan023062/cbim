import {crc32,deflateSync} from 'node:zlib';
import type {PngImageSchema} from '../src/logic/workspace/rules/png-validation-schema';

export const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
export function pngChunk(type:string,body:Uint8Array){const chunk=Buffer.alloc(body.byteLength+12);chunk.writeUInt32BE(body.byteLength);chunk.write(type,4,4,'ascii');chunk.set(body,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,chunk.length-4)),chunk.length-4);return chunk}
export function pngBytes({width=2,height=2,colorType=6,depth=8,compression=0,filterMethod=0,interlace=0,raw,idat,before=[],after=[]}:{width?:number;height?:number;colorType?:number;depth?:number;compression?:number;filterMethod?:number;interlace?:number;raw?:Uint8Array;idat?:Buffer[];before?:Buffer[];after?:Buffer[]}={}){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=depth;ihdr[9]=colorType;ihdr[10]=compression;ihdr[11]=filterMethod;ihdr[12]=interlace;
  return Buffer.concat([pngSignature,pngChunk('IHDR',ihdr),...before,...(idat??[deflateSync(raw??Buffer.alloc(((colorType===2?3:4)*width+1)*height))]).map(part=>pngChunk('IDAT',part)),...after,pngChunk('IEND',Buffer.alloc(0))]);
}
function icon(size:number,offset=0){const stride=size*4,raw=Buffer.alloc((stride+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*(stride+1)+1+x*4;raw[i]=(x*7+offset)%256;raw[i+1]=y*7;raw[i+2]=120;raw[i+3]=x===0||y===0?0:255}return pngBytes({width:size,height:size,raw})}
export const pngValidationData={model:'png-validation-fixture',goal:'PNG_VALIDATION_MAIN: 导出并真实验证32像素界面资源',memberGoal:'PNG_VALIDATION_MEMBER: 重新导出正确PNG并验证实际像素后交付',file:'status-icon.png',requirementId:'status-icon',binary:'base64' as const,bad:icon(16).toString('base64'),good:icon(32).toString('base64'),changed:icon(32,30).toString('base64'),acceptance:['真实PNG完整可解码，尺寸与RGBA通道符合冻结要求'],draft:'保留普通草稿；编码检查不代表视觉效果已验收。',humanId:'png-human-review',humanCriterion:'请人工判断PNG界面资源是否符合视觉与业务要求',schema:{width:32,height:32,colorType:'rgba'} satisfies PngImageSchema};
