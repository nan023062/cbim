/**
 * 目录归属：backend/main/platform/files；受控文件、产物读取与验证平台。
 * 作用定位：安全文件端口后的有界静态 PNG 解码器，核全部块及压缩数据并还原实际像素。
 * 设计原因：签名或IHDR合法不代表文件可解码；只解释明确子集，未知扩展不能被静默忽略后签发通过。
 * 职责边界：不做文件I/O、图像显示、色彩转换或视觉判断；像素只留本次内存，平台调用方继续核停止与文件身份。
 */
import {inflateSync} from 'node:zlib';
import {fail} from '../../../../core/errors';
import {pngImageSchema,pngValidationLimits,type PngImageSchema,type PngValidationOutcome} from '../../../../logic/workspace/rules/png-validation-schema';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,value)=>{let c=value;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0};
type Issue=PngValidationOutcome['issues'][number];
/** 仅平台内部消费；pixels是还原后的逐行RGB/RGBA字节，不能进入模型或公开验证回包。 */
export type PngRasterResult={ok:true;width:number;height:number;colorType:PngImageSchema['colorType'];pixels:Uint8Array}|{ok:false;issue:Issue};
const invalid=(keyword:string,instancePath='',code:Issue['code']='png_invalid'):PngRasterResult=>({ok:false,issue:{code,instancePath,keyword}});
const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};

/** 完整解码后才返回像素；预算超限抛VALIDATION_LIMIT，坏编码和不支持的子集返回固定诊断。 */
export function decodePngRaster(bytes:Uint8Array):PngRasterResult{
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>pngValidationLimits.fileBytes)fail('VALIDATION_LIMIT','PNG产物超过1 MiB');
  const data=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(data.length<8||!data.subarray(0,8).equals(signature))return invalid('signature');
  let offset=8,count=0,width=0,height=0,channels=0,ended=false,gamma:number|undefined;const idat:Buffer[]=[],metadata=new Set<string>();
  while(offset<data.length){
    if(++count>pngValidationLimits.chunks)fail('VALIDATION_LIMIT','PNG块数超过1024');
    if(data.length-offset<12)return invalid('truncated','/chunks');
    const length=data.readUInt32BE(offset),end=offset+12+length,typeBytes=data.subarray(offset+4,offset+8);
    if(length>0x7fffffff||end>data.length)return invalid('truncated','/chunks');
    if(!typeBytes.every(byte=>byte>=65&&byte<=90||byte>=97&&byte<=122)||typeBytes[2]>=97)return invalid('chunkType','/chunks');
    if(crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))return invalid('crc','/chunks');
    const type=typeBytes.toString('ascii'),body=data.subarray(offset+8,end-4);offset=end;
    if(count===1&&type!=='IHDR')return invalid('headerOrder','/IHDR');
    if(type==='IHDR'){
      if(count!==1||length!==13)return invalid('header','/IHDR');
      width=body.readUInt32BE(0);height=body.readUInt32BE(4);
      if(!width||!height||width>0x7fffffff||height>0x7fffffff)return invalid('dimensions','/IHDR');
      if(width>pngValidationLimits.dimension||height>pngValidationLimits.dimension||width*height>pngValidationLimits.pixels)fail('VALIDATION_LIMIT','PNG尺寸或实际像素超过解码上限');
      if(body[8]!==8||![2,6].includes(body[9])||body[10]!==0||body[11]!==0||body[12]!==0)return invalid('profile','/IHDR','png_unsupported');
      channels=body[9]===2?3:4;
    }else if(type==='IDAT')idat.push(body);
    else if(type==='IEND'){
      if(length!==0||!idat.length||offset!==data.length)return invalid('end','/IEND');ended=true;break;
    }else if(['sRGB','gAMA','pHYs'].includes(type)){
      if(idat.length||metadata.has(type))return invalid('metadataOrder','/chunks');metadata.add(type);
      if(type==='sRGB'&&(length!==1||body[0]>3)||type==='gAMA'&&(length!==4||body.readUInt32BE(0)===0||body.readUInt32BE(0)>0x7fffffff)||type==='pHYs'&&(length!==9||body[8]>1||body.readUInt32BE(0)>0x7fffffff||body.readUInt32BE(4)>0x7fffffff))return invalid('metadata','/chunks');
      if(type==='gAMA')gamma=body.readUInt32BE(0);
    }else return invalid('chunk','/chunks','png_unsupported');
  }
  if(!ended)return invalid('end','/IEND');
  if(metadata.has('sRGB')&&gamma!==undefined&&gamma!==45455)return invalid('colorMetadata','/chunks');
  const packed=Buffer.concat(idat),stride=width*channels,expected=(stride+1)*height;let raw:Buffer;
  try{
    // 默认Z_FINISH要求完整流；info核消耗长度，拒绝第二压缩流或尾随字节，不能借有效前缀通过。
    const value=inflateSync(packed,{maxOutputLength:expected,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
    if(value.engine.bytesWritten!==packed.length||value.buffer.length!==expected)return invalid('scanlineLength','/IDAT');raw=value.buffer;
  }catch{return invalid('deflate','/IDAT')}
  const pixels=new Uint8Array(stride*height);
  for(let row=0;row<height;row++){
    const start=row*(stride+1),filter=raw[start];if(filter>4)return invalid('filter','/rows/'+row);
    for(let column=0;column<stride;column++){
      const index=row*stride+column,a=column>=channels?pixels[index-channels]:0,b=row?pixels[index-stride]:0,c=row&&column>=channels?pixels[index-stride-channels]:0;
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);pixels[index]=(raw[start+1+column]+predictor)&255;
    }
  }
  return {ok:true,width,height,colorType:channels===3?'rgb':'rgba',pixels};
}

/** 对同一实际字节完整解码，再匹配冻结宽高/通道；只返回无像素的原条件判定。 */
export function validatePngArtifact(rawSchema:PngImageSchema,bytes:Uint8Array):PngValidationOutcome{
  const parsed=pngImageSchema.safeParse(rawSchema);if(!parsed.success)fail('VALIDATION_SCHEMA_INVALID','PNG验证声明不受支持或超过边界');
  const decoded=decodePngRaster(bytes);if(!decoded.ok)return {outcome:'rejected',issues:[decoded.issue]};
  const schema=parsed.data,issues:PngValidationOutcome['issues']=[];
  if(decoded.width!==schema.width||decoded.height!==schema.height)issues.push({code:'png_dimensions',instancePath:'/IHDR',keyword:'dimensions'});
  if(decoded.colorType!==schema.colorType)issues.push({code:'png_color',instancePath:'/IHDR',keyword:'colorType'});
  return {outcome:issues.length?'rejected':'passed',issues};
}
