/**
 * 目录归属：backend/engines/codex；Codex 引擎适配。
 * 作用定位：核实 Codex 实际 rollout 的路径、原生身份、工作区与持久化动态工具目录。
 * 设计原因：App Server 自己分配 UUID；CBIM 必须读取真实 metadata，不能伪造与任务同名的原生历史。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Rust 在 Windows 恢复时返回长路径前缀；先归一为同一平台路径，再做归属和真实文件校验。 */
export function codexPath(file:string){return path.resolve(process.platform==='win32'?file.replace(/^\\\\\?\\UNC\\/,'\\\\').replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,''):file)}

/** 只读取私有目录内完整、有界、非链接原生文件；返回元数据供恢复前核对工具。 */
export async function readCodexSession(home:string,file:string,id:string,cwd:string){
  const root=await fs.realpath(path.join(home,'sessions')),absolute=codexPath(file),relative=path.relative(root,absolute);
  if(!relative||relative.startsWith('../../core/execution')||path.isAbsolute(relative)||!path.basename(file).endsWith('-'+id+'.jsonl'))throw Error('Codex 会话不属于本机受管目录');
  if(await fs.realpath(file)!==absolute)throw Error('Codex 会话路径包含链接');
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024)throw Error('Codex 会话文件不能可靠核实');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));if(!text.endsWith('\n'))throw Error('Codex 会话尾行不完整');
  const entries=text.trimEnd().split('\n').map(line=>JSON.parse(line));if(entries.length>100000||entries.some(entry=>!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.type!=='string'))throw Error('Codex 会话记录损坏');
  const meta=entries[0];if(meta.type!=='session_meta'||meta.payload?.id!==id||path.resolve(meta.payload.cwd??'')!==path.resolve(cwd)||entries.slice(1).some(entry=>entry.type==='session_meta'))throw Error('Codex 原生身份或工作区不一致');
  return meta.payload as {id:string;cwd:string;dynamic_tools?:{name:string}[]};
}
