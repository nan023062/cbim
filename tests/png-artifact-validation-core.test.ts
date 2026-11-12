import {expect,it} from 'vitest';
import {deflateSync} from 'node:zlib';
import {decodePngRaster,validatePngArtifact} from '../src/backend/main/platform/files/png-validator';
import {pngImageSchema,pngValidationLimits} from '../src/backend/core/workspace/png-validation-schema';
import {workflowContractSchema} from '../src/backend/core/workspace/workflow-contract';
import {pngBytes,pngChunk,pngSignature} from './png-validation-data';

const schema={width:2,height:2,colorType:'rgb' as const},pixels=[10,20,30,50,60,70,15,18,34,66,55,72];
// 手工计算的独立样本，不借产品过滤器或逆函数生成期望值。
const rows=[
 [0,10,20,30,50,60,70,0,15,18,34,66,55,72],
 [1,10,20,30,40,40,40,1,15,18,34,51,37,38],
 [2,10,20,30,50,60,70,2,5,254,4,16,251,2],
 [3,10,20,30,45,50,55,3,10,8,19,34,16,20],
 [4,10,20,30,40,40,40,4,5,254,4,16,251,2],
];
it.each(rows.map((raw,index)=>({raw,index})))('完整还原过滤器$index的全部像素并核冻结条件',({raw})=>{const bytes=pngBytes({colorType:2,raw:Buffer.from(raw)}),decoded=decodePngRaster(bytes);expect(decoded.ok).toBe(true);if(!decoded.ok)throw Error('decode');expect([...decoded.pixels]).toEqual(pixels);expect(decoded).toMatchObject(schema);expect(validatePngArtifact(schema,bytes)).toEqual({outcome:'passed',issues:[]})});
it('RGBA、透明像素、连续IDAT任意分割与零长度块；元数据不返回正文',()=>{
 const raw=Buffer.from([0,255,0,0,0,0,255,0,128]),packed=deflateSync(raw),before=[pngChunk('sRGB',Buffer.from([0])),pngChunk('gAMA',Buffer.from([0,0,177,143])),pngChunk('pHYs',Buffer.from([0,0,0,1,0,0,0,1,1]))],bytes=pngBytes({width:2,height:1,raw,before,idat:[Buffer.alloc(0),...Array.from(packed,byte=>Buffer.from([byte])),Buffer.alloc(0)]}),decoded=decodePngRaster(bytes);expect(decoded.ok).toBe(true);if(!decoded.ok)throw Error('decode');expect([...decoded.pixels]).toEqual([...raw.subarray(1)]);expect(validatePngArtifact({width:2,height:1,colorType:'rgba'},bytes)).toEqual({outcome:'passed',issues:[]});
});
it('实际可解码才判尺寸和通道，合法文件头不能洗掉损坏像素',()=>{
 const bytes=pngBytes();expect(validatePngArtifact({width:1,height:1,colorType:'rgb'},bytes).issues.map(i=>i.code)).toEqual(['png_dimensions','png_color']);
 const bad=pngBytes({idat:[Buffer.from('PRIVATE-PIXEL-DATA')]});const result=validatePngArtifact(schema,bad);expect(result.issues).toEqual([{code:'png_invalid',instancePath:'/IDAT',keyword:'deflate'}]);expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it.each([{depth:16},{colorType:0},{colorType:3},{colorType:4},{interlace:1},{compression:1},{filterMethod:1}])('不支持的PNG子集明确拒绝：%j',options=>{expect(validatePngArtifact(schema,pngBytes(options)).issues[0].code).toBe('png_unsupported')});
it.each(['PLTE','tEXt','acTL','fcTL','fdAT','abCD','ABCD'])('未知、调色板、文本或动画块不静默忽略：%s',type=>{expect(validatePngArtifact(schema,pngBytes({before:[pngChunk(type,Buffer.alloc(8))]})).issues[0].code).toBe('png_unsupported')});
it('所有块CRC、长度/顺序、重复与尾随字节严格核实',()=>{
 const good=pngBytes(),ihdr=good.subarray(8,33),cases=[Buffer.alloc(8),good.subarray(0,7),good.subarray(0,good.length-1),Buffer.concat([good,Buffer.from([0])]),Buffer.concat([pngSignature,pngChunk('IEND',Buffer.alloc(0))]),Buffer.concat([good.subarray(0,33),ihdr,good.subarray(33)])];
 for(const offset of [29,good.length-1]){const changed=Buffer.from(good);changed[offset]^=1;cases.push(changed)}
 const badLength=Buffer.from(good);badLength.writeUInt32BE(0xffffffff,33);cases.push(badLength);
 for(const bytes of cases)expect(validatePngArtifact(schema,bytes).issues[0].code).toBe('png_invalid');
});
it('元数据长度、位置、值与重复均验证，IDAT不能跨其它块',()=>{
 const gamma=pngChunk('gAMA',Buffer.from([0,0,0,1]));
 for(const before of [[pngChunk('sRGB',Buffer.from([4]))],[pngChunk('gAMA',Buffer.from([0]))],[pngChunk('gAMA',Buffer.alloc(4))],[pngChunk('pHYs',Buffer.alloc(8))],[gamma,gamma]])expect(validatePngArtifact(schema,pngBytes({before})).issues[0].code).toBe('png_invalid');
 expect(validatePngArtifact(schema,pngBytes({after:[gamma]})).issues[0].keyword).toBe('metadataOrder');
 for(const before of [[pngChunk('gAMA',Buffer.from([255,255,255,255]))],[pngChunk('pHYs',Buffer.from([128,0,0,0,0,0,0,1,1]))],[gamma,pngChunk('sRGB',Buffer.from([0]))],[pngChunk('sRGB',Buffer.from([0])),gamma]])expect(validatePngArtifact(schema,pngBytes({before})).issues[0].code).toBe('png_invalid');
});
it('压缩流截断/多余数据/膨胀及扫描行长度和过滤器均不能通过',()=>{
 const raw=Buffer.alloc(18),packed=deflateSync(raw);
 for(const idat of [[packed.subarray(0,packed.length-1)],[Buffer.concat([packed,Buffer.from([0])])],[Buffer.concat([packed,packed])],[deflateSync(Buffer.alloc(19))],[deflateSync(Buffer.alloc(17))],[deflateSync(Buffer.alloc(1024*1024))]])expect(validatePngArtifact(schema,pngBytes({idat})).issues[0].code).toBe('png_invalid');
 raw[0]=5;expect(validatePngArtifact(schema,pngBytes({raw})).issues[0].keyword).toBe('filter');
});
it('有界资源与严格冻结声明不截断或回退，PNG参数不能混成CSV/JSON',()=>{
 const bomb=pngBytes({width:4096,height:4096,raw:Buffer.alloc(1)});expect(()=>decodePngRaster(bomb)).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));expect(()=>decodePngRaster(new Uint8Array(pngValidationLimits.fileBytes+1))).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));
 expect(()=>decodePngRaster(pngBytes({idat:Array(1024).fill(Buffer.alloc(0))}))).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));
 for(const patch of [{width:0},{width:1.5},{height:4097},{width:4096,height:4096},{colorType:'palette'},{command:'decode'}])expect(pngImageSchema.safeParse({...schema,...patch}).success).toBe(false);
 const requirement={id:'image',validator:'png-raster-v1',artifactPath:'icon.png',schema};expect(workflowContractSchema.safeParse({version:1,delivery:{requiredValidations:[requirement]}}).success).toBe(true);for(const patch of [{schema:{type:'object'}},{artifactPath:'../out.png'},{validator:'png-any'}])expect(workflowContractSchema.safeParse({version:1,delivery:{requiredValidations:[{...requirement,...patch}]}}).success).toBe(false);
});
it('像素上限内仍完整还原，不以压缩比大为由跳过像素验证',()=>{
 const result=decodePngRaster(pngBytes({width:1024,height:1024}));expect(result.ok).toBe(true);if(!result.ok)throw Error('decode');expect(result.pixels.byteLength).toBe(1048576*4);expect(result.pixels.every(byte=>byte===0)).toBe(true);
});
