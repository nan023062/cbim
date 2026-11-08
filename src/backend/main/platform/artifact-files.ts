/**
 * 范围模式注入真实Win32目录/文件锁定读取；旧模式仍是前后尽力检测，两种能力不混称。
 * 作用定位：在固定工作区根内安全读取业务文件，供指纹采集、复核、无基线观察及冻结 JSON/CSV/PNG 验证共用。
 * 设计原因：哈希与专业验证必须使用同一次句柄读取的字节；路径逐级拒绝链接/越界，句柄与路径前后核对，超限不截断作证。
 * 职责边界：不运行命令、不读取目录或知识库、不返回文件正文；外部并发修改仅尽力检测，不构成操作系统沙箱或原子快照。
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import {artifactLimits,type ArtifactFileFact,type ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import {jsonValidationLimits,validateJsonArtifact,type BoundedJsonSchema} from '../../core/workspace/json-validation-schema';
import {csvValidationLimits,validateCsvArtifact,type CsvTableSchema} from '../../core/workspace/csv-validation-schema';
import {pngValidationLimits,type PngImageSchema} from '../../core/workspace/png-validation-schema';
import {validatePngArtifact} from './png-validator';
import type {EffectFileObservation} from '../../core/tasks/effect-observation';

export const artifactFileLimits={files:artifactLimits.files,bytesPerFile:artifactLimits.fileBytes,totalBytes:artifactLimits.totalBytes} as const;
const sameFile=(a:import('node:fs').Stats,b:import('node:fs').Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const inside=(root:string,file:string)=>{const relative=path.relative(root,file);return !!relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)};
const normal=(value:string)=>process.platform==='win32'?value.toLowerCase():value;
/** 纯格式归一化用于日志引用匹配，不替代 captureFiles 的真实路径和文件句柄核实。 */
export function normalizeArtifactPath(root:string,raw:string):string{
  if(typeof raw!=='string'||!raw.length||raw.length>4096||/[\x00-\x1f]/.test(raw)||/^(?:\\\\|\/\/|[a-z]+:\/\/|~)/i.test(raw))fail('ARTIFACT_PATH','文件路径不属于可核实的业务文件');
  const parts=raw.replaceAll('\\','/').split('/');
  if(parts.some(part=>part==='..'||part.toLowerCase()==='.cbim'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||/[. ]$/.test(part)))fail('ARTIFACT_PATH','文件路径包含受保护目录、跳转或设备名称');
  const noDrive=process.platform==='win32'?raw.replace(/^[a-z]:[\\/]/i,''):raw;
  if(noDrive.includes(':'))fail('ARTIFACT_PATH','文件路径不允许设备路径或备用数据流');
  const file=path.resolve(root,raw);if(!inside(root,file))fail('ARTIFACT_PATH','文件必须位于当前工作区内');
  return path.relative(root,file).split(path.sep).join('/');
}
/** 工作区所有者固定 root 和 assert；调用中的 paths 仍须全部通过平台检查，不能按来源回执跳过。 */
export class ArtifactFiles {
  constructor(private readonly root:string,private readonly assert:()=>void,private readonly secureRead?:(path:string,signal:AbortSignal)=>{bytes:Buffer;fact:{byteLength:number;sha256:string}}){}
  private async resolve(raw:string,signal:AbortSignal){
    this.assert();signal.throwIfAborted();
    const relativePath=normalizeArtifactPath(this.root,raw),root=await fs.realpath(this.root),file=path.resolve(root,raw);
    if(normal(root)!==normal(path.resolve(this.root)))fail('ARTIFACT_PATH','工作区实际位置已经变化');
    const relative=path.relative(root,file);let current=root;
    for(const part of relative.split(path.sep)){
      current=path.join(current,part);const stat=await fs.lstat(current);signal.throwIfAborted();
      if(stat.isSymbolicLink())fail('ARTIFACT_PATH','产物路径不能经过符号链接或目录联接');
    }
    const real=await fs.realpath(file);
    if(normal(real)!==normal(file)||!inside(root,real))fail('ARTIFACT_PATH','文件实际位置与工作区路径不一致');
    return {file,relativePath};
  }
  /** 输入与输出逐项对应；重复别名也占读取额度，调用方只能在可信指纹返回后归并。 */
  async captureFiles(paths:readonly string[],signal:AbortSignal):Promise<ArtifactFileFact[]>{
    return this.readFiles(paths,signal,{readBytes:0});
  }
  /** 原授权路径的当前观察不要求成功基线；不存在与空文件分开，失败不读取正文或推断旧操作结果。 */
  async observeFiles(paths:readonly string[],signal:AbortSignal):Promise<EffectFileObservation[]>{
    if(!paths.length||paths.length>artifactFileLimits.files)fail('ARTIFACT_LIMIT','一次最多观察 16 个文件');
    const budget={readBytes:0},result:EffectFileObservation[]=[];
    for(const raw of paths){
      const relativePath=normalizeArtifactPath(this.root,raw);
      try{const {fact}=await this.readFile(relativePath,signal,budget,artifactFileLimits.bytesPerFile,false);result.push({relativePath,state:'present',byteLength:fact.byteLength,sha256:fact.sha256})}
      catch(error){
        this.assert();signal.throwIfAborted();const code=(error as {code?:string})?.code;
        result.push({relativePath,state:code==='ENOENT'?'missing':'unverifiable',reason:code==='ENOENT'?'当前文件不存在':code==='ARTIFACT_CHANGED'?'读取期间文件发生变化':code==='ARTIFACT_LIMIT'?'文件超过本次观察的字节上限':'文件不能安全读取，未取得当前内容证明'});
      }
    }
    return result;
  }
  /** 仅可信冻结要求调用；同一 Buffer 同时确定哈希、严格解析与验证，正文不离开平台端口。 */
  async validateFile(expected:ArtifactFileFact,schema:BoundedJsonSchema,signal:AbortSignal){
    const {fact,bytes}=await this.readFile(expected.relativePath,signal,{readBytes:0},jsonValidationLimits.fileBytes,true);
    if(fact.relativePath!==normalizeArtifactPath(this.root,expected.relativePath)||fact.byteLength!==expected.byteLength||fact.sha256!==expected.sha256)fail('VALIDATION_BASELINE_CHANGED','JSON 文件已偏离明确基线，请重新读取与采集');
    const result=validateJsonArtifact(schema,bytes!);this.assert();signal.throwIfAborted();
    return {artifact:fact,...result};
  }
  /** CSV 使用同一安全句柄取得指纹与全部表格字节；解析不执行公式，错误不返回单元格正文。 */
  async validateTable(expected:ArtifactFileFact,schema:CsvTableSchema,signal:AbortSignal){
    const {fact,bytes}=await this.readFile(expected.relativePath,signal,{readBytes:0},csvValidationLimits.fileBytes,true);
    if(fact.relativePath!==normalizeArtifactPath(this.root,expected.relativePath)||fact.byteLength!==expected.byteLength||fact.sha256!==expected.sha256)fail('VALIDATION_BASELINE_CHANGED','CSV 文件已偏离明确基线，请重新读取与采集');
    const result=validateCsvArtifact(schema,bytes!);this.assert();signal.throwIfAborted();
    return {artifact:fact,...result};
  }
  /** PNG指纹与有界解码共用完整读取；像素不出平台，解码结束再次核停止与工作区有效性。 */
  async validateImage(expected:ArtifactFileFact,schema:PngImageSchema,signal:AbortSignal){
    const {fact,bytes}=await this.readFile(expected.relativePath,signal,{readBytes:0},pngValidationLimits.fileBytes,true);
    if(fact.relativePath!==normalizeArtifactPath(this.root,expected.relativePath)||fact.byteLength!==expected.byteLength||fact.sha256!==expected.sha256)fail('VALIDATION_BASELINE_CHANGED','PNG文件已偏离明确基线，请重新读取与采集');
    const result=validatePngArtifact(schema,bytes!);this.assert();signal.throwIfAborted();return {artifact:fact,...result};
  }
  /** 一份明确基线的逐文件只读结果；失败不抹去其它文件观察，所有读取共用总字节上限。 */
  async checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>{
    if(!files.length||files.length>artifactFileLimits.files)fail('ARTIFACT_LIMIT','一次最多核实 16 个文件');
    const result:ArtifactFileCheck[]=[],budget={readBytes:0};
    for(const file of files){
      const expected={byteLength:file.byteLength,sha256:file.sha256};
      try{
        const [observed]=await this.readFiles([file.relativePath],signal,budget);
        result.push({relativePath:file.relativePath,state:observed.byteLength===file.byteLength&&observed.sha256===file.sha256?'matches':'changed',expected,observed:{byteLength:observed.byteLength,sha256:observed.sha256}});
      }catch(error){const missing=(error as {code?:string})?.code==='ENOENT';result.push({relativePath:file.relativePath,state:missing?'missing':'unverifiable',expected,reason:missing?'文件已不存在':'文件无法安全读取、超过本次上限或读取期间发生变化'})}
    }
    return result;
  }
  private async readFiles(paths:readonly string[],signal:AbortSignal,budget:{readBytes:number}):Promise<ArtifactFileFact[]>{
    if(!paths.length||paths.length>artifactFileLimits.files)fail('ARTIFACT_LIMIT','一次最多核实 16 个文件');
    const result:ArtifactFileFact[]=[];
    for(const raw of paths)result.push((await this.readFile(raw,signal,budget,artifactFileLimits.bytesPerFile,false)).fact);
    return result;
  }
  /** 哈希与可选的验证字节共用一个有界读取循环；原采集接口仍不保留或返回正文。 */
  private async readFile(raw:string,signal:AbortSignal,budget:{readBytes:number},maxBytes:number,retainBytes:boolean){
      // 范围模式由宿主注入实际 Win32 锁定读取；旧任务保留原来的尽力检测语义。
      if(this.secureRead){this.assert();signal.throwIfAborted();const relativePath=normalizeArtifactPath(this.root,raw),value=this.secureRead(relativePath,signal);budget.readBytes+=value.bytes.length;if(value.bytes.length>maxBytes||budget.readBytes>artifactFileLimits.totalBytes)fail('ARTIFACT_LIMIT','文件超过本次读取上限');return {fact:{relativePath,...value.fact},...(retainBytes?{bytes:value.bytes}:{})}}
      const target=await this.resolve(raw,signal),before=await fs.lstat(target.file);
      if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)fail('ARTIFACT_PATH','只核实未链接的普通业务文件');
      if(before.size>maxBytes||budget.readBytes+before.size>artifactFileLimits.totalBytes)fail(retainBytes?'VALIDATION_LIMIT':'ARTIFACT_LIMIT',retainBytes?'产物超过单文件 1 MiB 的验证上限':'文件超过单文件 8 MiB 或总计 32 MiB 的核实上限');
      const flags=constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK),handle=await fs.open(target.file,flags);
      try{
        const opened=await handle.stat();signal.throwIfAborted();
        if(!opened.isFile()||opened.nlink!==1||!sameFile(before,opened))fail('ARTIFACT_CHANGED','打开文件期间产物已经变化，请重新核实');
        const digest=createHash('sha256'),buffer=Buffer.alloc(64*1024),chunks:Buffer[]=[];let length=0;
        while(length<opened.size){
          this.assert();signal.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,opened.size-length),length);budget.readBytes+=bytesRead;signal.throwIfAborted();
          if(!bytesRead)break;length+=bytesRead;
          digest.update(buffer.subarray(0,bytesRead));
          if(retainBytes)chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));
        }
        const after=await handle.stat(),again=await this.resolve(raw,signal),current=await fs.lstat(again.file);
        if(length!==opened.size||after.nlink!==1||current.nlink!==1||!sameFile(opened,after)||!sameFile(after,current)||normal(again.file)!==normal(target.file))fail('ARTIFACT_CHANGED','读取期间产物已经变化，请重新核实');
        this.assert();signal.throwIfAborted();
        return {fact:{relativePath:target.relativePath,byteLength:length,sha256:digest.digest('hex')},...(retainBytes?{bytes:Buffer.concat(chunks,length)}:{})};
      }finally{await handle.close()}
  }
}
