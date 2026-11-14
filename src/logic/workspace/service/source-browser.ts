/**
 * 作用定位：按正式模块的 sources 绑定提供只读目录枚举与文本预览，供可信桌面桥接调用。
 * 设计原因：知识快照决定范围，文件系统决定实际内容；不复用知识文件树伪造源码，也不把浏览变成执行许可。
 * 边界：拒绝链接、知识/版本库目录、越界和旧实例/知识版本；有限枚举、有限文本，不写文件或启动任务。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import {fail} from '../../../core/errors';
import type {Snapshot} from '../../knowledge/rules/types';
import {sourceDirectoryInput,sourceFileInput,type SourceDirectory,type SourceFile,type SourceTarget} from '../rules/source-browser';
/** 只需要知识读取与当前实例核实，不持有 Application 或任何写入能力。 */
export interface SourceBrowserWorkspace {entry:{id:string;path:string};assert(identity:{workspaceId:string;instanceId:string}):void;read():Promise<Snapshot>}
const textLimit=256*1024;
function segments(value:string,empty=false){
 if(empty&&value==='')return [];
 const parts=value.split('/');
 if(!value||value.length>2048||parts.length>64||parts.some(part=>!part||part==='.'||part==='..'||/[\\:*?"<>|\x00-\x1f]/.test(part)||/[. ]$/.test(part)))fail('SOURCE_PATH','源路径必须是模块绑定目录内的相对路径');
 return parts;
}
function protectedPath(value:string){return value.split('/').some(part=>['.cbim','.git'].includes(part.toLowerCase()))}
const same=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
/** 每次操作从当前快照重新验证绑定；结束再次检查版本，迟到结果不返回给另一实例。 */
export class ModuleSourceBrowser {
 constructor(private readonly workspace:SourceBrowserWorkspace){}
 private async binding(input:SourceTarget){
  this.workspace.assert(input);const snapshot=await this.workspace.read();this.check(snapshot,input);
  if(!input.moduleId.startsWith('.cbim/workspace/')||segments(input.moduleId).length<3)fail('SOURCE_MODULE','请选择正式业务模块');
  let definition:{sources?:{location?:string}[]};try{definition=JSON.parse(snapshot.files.find(file=>file.path===input.moduleId+'/module.json')?.text??'null')}catch{fail('SOURCE_MODULE','模块定义无法读取，请刷新架构')}
  const declared=definition&&Array.isArray(definition.sources)&&definition.sources.some(source=>typeof source?.location==='string'&&source.location.replaceAll('\\','/')===input.source);
  if(!declared)fail('SOURCE_BINDING','模块未绑定此源目录，请刷新架构');
  // 先精确匹配知识中的声明，再兼容既有目录写法；文件相对路径不接受这些别名或父级穿越。
  if(input.source.startsWith('/'))fail('SOURCE_PATH','模块源绑定不能是绝对路径');
  const sourceParts=segments(input.source.split('/').filter(part=>part!==''&&part!=='.').join('/'));
  const relative=[...sourceParts,...segments(input.path??'',true)].join('/');
  const ignored=ignore({ignorecase:true}).add(snapshot.files.find(file=>file.path==='.cbim/.cbimignore')?.text??'');
  if(protectedPath(relative)||ignored.ignores(relative)||ignored.ignores(relative+'/'))fail('SOURCE_IGNORED','此路径不属于可浏览的业务源码范围');
  const root=await fs.realpath(this.workspace.entry.path);
  const checkPath=async()=>{
   let current=root;
   for(const part of segments(relative)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())fail('SOURCE_LINK','源浏览不跟随符号链接或目录联接')}
   const real=await fs.realpath(current),rel=path.relative(root,real);
   if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('SOURCE_PATH','源路径越出工作区');
   return current;
  };
  const target=await checkPath();
  if(!(await fs.stat(path.join(root,...sourceParts))).isDirectory())fail('SOURCE_KIND','模块源绑定必须是目录');
  return {target,relative,ignored,checkPath};
 }
 private check(snapshot:Snapshot,input:SourceTarget){
  this.workspace.assert(input);
  if(snapshot.workspaceId!==input.workspaceId||snapshot.instanceId!==input.instanceId||snapshot.revision!==input.revision)fail('SOURCE_STALE','模块绑定或工作区已变化，请刷新架构后重试');
 }
 private async finish(input:SourceTarget){this.check(await this.workspace.read(),input)}
 private async guarded<T>(run:()=>Promise<T>):Promise<T>{try{return await run()}catch(error){
  const code=(error as {code?:string})?.code;
  if(code?.startsWith('SOURCE_')||code==='STALE_INSTANCE'||code==='NOT_RUNNING')throw error;
  fail('SOURCE_READ',code==='ENOENT'?'源目录或文件不存在，请刷新目录':code==='EACCES'||code==='EPERM'?'没有权限读取此源目录或文件':'源目录或文件读取失败，请刷新后重试');
 }}
 /** 单次最多检查 2000 个目录项、返回 200 项；不递归预读，不枚举链接目标。 */
 async list(raw:unknown):Promise<SourceDirectory>{const input=sourceDirectoryInput.parse(raw);return this.guarded(async()=>{
  const scope=await this.binding(input),before=await fs.stat(scope.target);
  if(!before.isDirectory())fail('SOURCE_KIND','此路径不是目录');
  const directory=await fs.opendir(scope.target),entries:SourceDirectory['entries']=[];let seen=0,scanned=0,nextOffset:number|undefined;
  try{for await(const entry of directory){
   if(seen++<input.offset)continue;
   if(entries.length===200||scanned===2000){nextOffset=seen-1;break}scanned++;
   const relative=scope.relative+'/'+entry.name;
   if(entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile())||protectedPath(relative)||scope.ignored.ignores(relative+(entry.isDirectory()?'/':'')))continue;
   try{segments(entry.name)}catch{continue}
   entries.push({name:entry.name,path:input.path?input.path+'/'+entry.name:entry.name,kind:entry.isDirectory()?'directory':'file'});
  }}finally{await directory.close().catch(error=>{if(error.code!=='ERR_DIR_CLOSED')throw error})}
  await scope.checkPath();const after=await fs.stat(scope.target);
  if(!same(before,after)||before.mtimeMs!==after.mtimeMs)fail('SOURCE_CHANGED','枚举期间目录已变化，请刷新目录');
  await this.finish(input);
  entries.sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name));
  return {entries,...(nextOffset===undefined?{}:{nextOffset})};
 })}
 /** 只预览普通 UTF-8 文本；大文件和二进制返回明确说明，绝不执行 HTML/脚本。 */
 async read(raw:unknown):Promise<SourceFile>{const input=sourceFileInput.parse(raw);return this.guarded(async()=>{
  const scope=await this.binding(input),before=await fs.lstat(scope.target);
  if(!before.isFile())fail('SOURCE_KIND','此路径不是普通文件');
  const handle=await fs.open(scope.target,'r');
  try{
   const opened=await handle.stat();if(!same(before,opened))fail('SOURCE_CHANGED','打开期间文件已变化，请重新选择');
   let result:SourceFile;
   if(opened.size>textLimit)result={kind:'unsupported',reason:'文件超过 256 KiB，未读取正文',bytes:opened.size};
   else {
    const buffer=Buffer.alloc(textLimit+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead}
    const data=buffer.subarray(0,length);
    if(length>textLimit)fail('SOURCE_CHANGED','读取期间文件变大，请重新选择');
    let text:string|undefined;
    try{if(!data.includes(0))text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{/* 二进制或非 UTF-8 只返回说明 */}
    result=text===undefined?{kind:'unsupported',reason:'此文件不是可预览的 UTF-8 文本',bytes:length}:{kind:'text',text,bytes:length};
   }
   await scope.checkPath();const after=await fs.lstat(scope.target),final=await handle.stat();
   if(!same(before,after)||!same(opened,final)||opened.size!==final.size||opened.mtimeMs!==final.mtimeMs)fail('SOURCE_CHANGED','读取期间文件已变化，请重新选择');
   await this.finish(input);return result;
  }finally{await handle.close()}
 })}
}
