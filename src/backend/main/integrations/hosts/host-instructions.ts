/**
 * 作用定位：生成与同步 AGENTS/CLAUDE 托管启动区块，备份并清理已知旧入口。
 * 设计原因：将入口正文直接嵌入宿主启动文件，迁移已知旧入口并保留无关用户内容。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Paths} from '../../platform/paths';
import {atomic} from '../../../core/foundation/files';
import {fail} from '../../../core/foundation/errors';
import {hostPrompt} from './host-prompt';
import {builtinSkills} from '../../../core/knowledge/builtins';
import type {WorkspaceEntry} from '../../../../bridge/contracts/workspace';

const begin='<!-- BEGIN CBIM ENTRY -->',end='<!-- END CBIM ENTRY -->';
export function buildHostInstructions(eol='\n'){
  const declarations=builtinSkills.map(s=>'| '+s.title+' | cbim_skill_'+s.id.replaceAll('-','_')+' | '+s.description+' |').join('\n');
  return [begin,hostPrompt.trim(),'## 内置 Skill 工具声明','| Skill | MCP 工具 | 用途 |','|---|---|---|',declarations,'调用以上工具取得正文，由宿主按返回流程执行。不得读取 .cbim/，所有知识操作经 CBIM MCP。',end].join('\n').replace(/\r?\n/g,eol);
}

async function readRegular(root:string,name:string){
  const target=path.join(root,name);
  try{const stat=await fs.lstat(target);if(stat.isSymbolicLink()||!stat.isFile())fail('HOST_INSTRUCTIONS_PATH',`${name} 不是普通文件，已保留，请检查链接或目录`);return await fs.readFile(target)}
  catch(e:any){if(e.code==='ENOENT')return null;throw e}
}

function merge(text:string,block:string,eol:string){
  // Old installations also emitted this unmarked section outside our managed block.
  // Match its complete, known wording rather than deleting arbitrary entry references.
  const legacy=/^#{1,6}[\t ]+(?:Claude|Codex|Agent|AGENTS|CBIM)[\t ]*工作流入口[\t ]*\r?\n(?:[\t ]*\r?\n)*[\t ]*(?:\*\*)?完整读取并立即执行[\t ]*\[CBIM 启动入口\]\((?:\.\/)?\.cbim\/entry\.md\)[。.]?(?:\*\*)?[\t ]*(?:\r?\n)+(?:[\t ]*\r?\n)*[\t ]*(?:\*\*)?后续工作流加载与执行均由该入口路由，不在本文件展开流程规则。[\t ]*(?:\*\*)?[\t ]*(?:\r?\n)+(?:[\t ]*\r?\n)*[\t ]*(?:\*\*)?入口缺失或无法读取时，报告具体路径并停止工作流启动；不得自行回退到其他工作流。(?:\*\*)?[\t ]*(?:\r?\n|$)/gm;
  text=text.replace(legacy,'');
  // Remove only the exact legacy Claude import, never arbitrary user prose.
  text=text.replace(/^[\t ]*@(?:\.\/)?\.cbim\/entry\.md[\t ]*(?:\r?\n|$)/gm,'');
  const starts=[...text.matchAll(/^<!-- BEGIN CBIM ENTRY -->\r?$/gm)],ends=[...text.matchAll(/^<!-- END CBIM ENTRY -->\r?$/gm)];
  if(starts.length===0&&ends.length===0){
    if(text.includes(begin)||text.includes(end))fail('HOST_INSTRUCTIONS_BLOCK','CBIM 标记格式异常，已保留原文件');
    // Keep a BOM and an existing YAML frontmatter at the beginning of the file.
    let position=text.startsWith('\uFEFF')?1:0;
    const frontmatter=text.slice(position).match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
    if(frontmatter)position+=frontmatter[0].length;
    return text.slice(0,position)+(position&&text[position-1]!=='\n'&&text[position-1]!=='\uFEFF'?eol:'')+block+eol+eol+text.slice(position);
  }
  if(starts.length!==1||ends.length!==1||starts[0].index!>=ends[0].index!)fail('HOST_INSTRUCTIONS_BLOCK','CBIM 区块重复或不完整，已保留原文件');
  return text.slice(0,starts[0].index)+block+text.slice(ends[0].index!+end.length);
}

export async function installHostInstructions(paths:Paths,entry:WorkspaceEntry){
  const warnings:string[]=[];
  for(const name of ['AGENTS.md','CLAUDE.md','AGENTS.override.md']){try{
    const before=await readRegular(entry.path,name);
    // Do not create an override file that would hide existing AGENTS.md rules.
    if(name==='AGENTS.override.md'&&before===null)continue;
    const text=before?.toString('utf8')||'';
    if(before&&!Buffer.from(text,'utf8').equals(before))fail('HOST_INSTRUCTIONS_ENCODING',`${name} 不是有效 UTF-8，已保留原文件`);
    const eol=text.includes('\r\n')?'\r\n':'\n',after=merge(text,buildHostInstructions(eol),eol);
    if(after===text)continue;
    if(before!==null){
      const directory=path.join(paths.project(entry.id),'host-instructions-backups');await fs.mkdir(directory,{recursive:true});
      const backup=path.join(directory,`${name}.${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.md`);
      const file=await fs.open(backup,'wx',0o600);try{await file.writeFile(before);await file.sync()}finally{await file.close()}
    }
    const live=await readRegular(entry.path,name);
    if(before===null?live!==null:live===null||!before.equals(live))fail('HOST_INSTRUCTIONS_CONFLICT',`${name} 在同步期间被修改，请重试`);
    await atomic(path.join(entry.path,name),after);
  }catch(e:any){warnings.push(`${name}: ${e.message}`)}}
  return warnings;
}
