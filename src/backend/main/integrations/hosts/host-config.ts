/**
 * 作用定位：生成工作区唯一的 Codex/Claude MCP 配置并保留已有无关配置。
 * 设计原因：按宿主格式合并托管配置，单个配置失败只产生警告，不停止其他工作区服务。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {parse as parseToml,stringify as stringifyToml} from 'smol-toml';
import {applyEdits,modify,parse, type ParseError} from 'jsonc-parser';
import {Paths} from '../../platform/paths';
import {atomic,exists} from '../../../core/foundation/files';
import {fail} from '../../../core/foundation/errors';
import type {WorkspaceEntry} from '../../../../bridge/contracts/workspace';

/** 宿主启动 stdio 桥的可执行程序和固定前置参数；工作区身份由安装器追加。 */
export interface HostRuntime {command:string;args:string[]}
// Each file is independently installed, so one invalid host config cannot stop MCP.
export async function installHostConfigs(paths:Paths,entry:WorkspaceEntry,runtime:HostRuntime){
  const name='cbim-'+entry.id;
  const spec={command:runtime.command,args:[...runtime.args,'--root',entry.path,'--user-data',paths.userRoot,'--workspace-id',entry.id],env:{ELECTRON_RUN_AS_NODE:'1'}};
  const warnings:string[]=[];
  for(const host of ['codex','claude'] as const){try{
    const relative=host==='codex'?'.codex/config.toml':'.mcp.json';
    let target=entry.path;
    for(const part of relative.split('/')){
      target=path.join(target,part);
      if(await exists(target)&&(await fs.lstat(target)).isSymbolicLink())fail('HOST_CONFIG_LINK',`${relative} 不允许链接，未修改`);
    }
    const before=await exists(target)?await fs.readFile(target,'utf8'):'';
    let after:string;
    if(host==='claude'){
      const errors:ParseError[]=[];const data=before?parse(before,errors):{};
      if(errors.length||!data||typeof data!=='object'||Array.isArray(data)||data.mcpServers&&(typeof data.mcpServers!=='object'||Array.isArray(data.mcpServers)))fail('HOST_CONFIG',`${relative} 格式无效，已保留原文件`);
      const old=data.mcpServers?.[name];
      if(old&&!Array.isArray(old.args))fail('HOST_CONFIG',`${relative} 中同名配置不属于 CBIM，已保留`);
      if(old&&!old.args.includes(entry.id))fail('HOST_CONFIG',`${relative} 中同名配置绑定不同工作区，已保留`);
      after=applyEdits(before||'{}\n',modify(before||'{}\n',['mcpServers',name],{type:'stdio',...spec},{formattingOptions:{insertSpaces:true,tabSize:2}}));
    }else{
      const begin=`# BEGIN CBIM ${entry.id}`,end=`# END CBIM ${entry.id}`;
      const data=before?parseToml(before):{};
      const start=before.indexOf(begin),finish=before.indexOf(end);
      if((start<0)!==(finish<0)||start>=0&&finish<start)fail('HOST_CONFIG',`${relative} 的 CBIM 管理区块不完整，已保留`);
      const base=start<0?before:before.slice(0,start)+before.slice(finish+end.length);
      const remainder=base.trim()?parseToml(base):{};
      if((remainder.mcp_servers as any)?.[name])fail('HOST_CONFIG',`${relative} 中存在同名手工配置，已保留`);
      // Parse both versions before writing; preserve every unrelated comment and setting.
      void data;
      const block=`${begin}\n${stringifyToml({mcp_servers:{[name]:spec}})}${end}`;
      after=start<0?before+(before.endsWith('\n')||!before?'':'\n')+'\n'+block+'\n':before.slice(0,start)+block+before.slice(finish+end.length);
      parseToml(after);
    }
    if(after!==before){
      if((await exists(target)?await fs.readFile(target,'utf8'):'')!==before)fail('HOST_CONFIG_CONFLICT',`${relative} 被外部修改，请重试`);
      if(before)await atomic(target+'.cbim-backup',before);
      await atomic(target,after);
    }
  }catch(e:any){warnings.push(`${host}: ${e.message}`)}}
  return warnings;
}
