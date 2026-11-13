/**
 * 目录归属：backend/main/knowledge；知识物理事务与恢复。
 * 作用定位：从本机项目读取受控的正式知识文件。
 * 设计原因：物理遍历、大小限制和链接检查与领域校验分开；只读取 .cbim 的允许内容，保留原始哈希语义。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {StoragePaths as Paths} from '../../../logic/workspace/ports/paths';
import type {KnowledgeFile} from '../../../logic/knowledge/rules/types';
import {isKnowledge,excluded} from '../../../logic/knowledge/rules/knowledge';
import {fail} from '../../../core/errors';
import {hash} from '../../../core/platform/node/serialization';
import {exists} from '../../../core/platform/node/files';
export async function readKnowledge(paths:Paths,root:string){
  const result:KnowledgeFile[]=[];
  async function walk(relative:string){const absolute=await paths.knowledge(root,relative+'/__check__');const dir=path.dirname(absolute);
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=relative+'/'+entry.name;if(excluded.has(entry.name))continue;
      if(entry.isSymbolicLink())fail('PATH',`知识目录包含链接：${p}`);
      if(entry.isDirectory()){if(relative==='.cbim'&&!['workspace','team','connectors'].includes(entry.name))continue;await walk(p)}
      else if(isKnowledge(p)){const target=await paths.knowledge(root,p);const stat=await fs.stat(target);if(stat.size>2*1024*1024)fail('SIZE',`知识文件超过 2 MiB：${p}`);const text=await fs.readFile(target,'utf8');result.push({path:p,text,hash:hash(text)});if(result.length>20000)fail('SIZE','知识对象超过 20000 个')}
    }}
  if(await exists(path.join(root,'.cbim')))await walk('.cbim');return result.sort((a,b)=>a.path.localeCompare(b.path));
}
