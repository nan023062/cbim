/**
 * 作用定位：安装 ignore、宿主权限与 Hook 配置，保留原有规则并返回可见警告。
 * 设计原因：组合忽略、权限与 Hook 提供防误操作保护；它们不等于对任意 shell 的操作系统隔离。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {applyEdits,modify,parse,ParseError} from 'jsonc-parser';
import {Paths} from '../../platform/paths';
import {atomic,exists} from '../../../core/foundation/files';
import {fail} from '../../../core/foundation/errors';
import type {WorkspaceEntry} from '../../../../bridge/contracts/workspace';
import type {HostRuntime} from './host-config';
import {parse as parseToml,stringify as stringifyToml} from 'smol-toml';

const marker='CBIM knowledge access guard';
export function guardCommands(entry:WorkspaceEntry,runtime:HostRuntime){
  const args=runtime.args.map(a=>a.replace(/host-bridge\.(js|ts)$/,'host-guard.$1')).concat(['--root',entry.path,'--workspace-id',entry.id]);
  const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
  const ps=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  const script=`$ProgressPreference='SilentlyContinue'; $env:ELECTRON_RUN_AS_NODE='1'; $OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $cbimPayload=[Console]::In.ReadToEnd(); $cbimPayload | & ${[runtime.command,...args].map(ps).join(' ')} | Write-Output; exit $LASTEXITCODE`;
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return {command:'ELECTRON_RUN_AS_NODE=1 '+[runtime.command,...args].map(quote).join(' '),commandWindows:'& '+ps(powershell)+' -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')+'; exit $LASTEXITCODE'};
}
export async function installHostProtection(paths:Paths,entry:WorkspaceEntry,runtime:HostRuntime){
  const warnings:string[]=[],commands=guardCommands(entry,runtime);
  for(const relative of ['.ignore','.claude/settings.local.json','.codex/hooks.json','.codex/config.toml'])try{
    let target=entry.path;for(const part of relative.split('/')){target=path.join(target,part);if(await exists(target)&&(await fs.lstat(target)).isSymbolicLink())fail('HOST_CONFIG_LINK','配置路径是链接，已保留')}
    const before=await exists(target)?await fs.readFile(target,'utf8'):'';let after=before;
    if(relative==='.ignore'){
      const begin='# BEGIN CBIM KNOWLEDGE FILTER',end='# END CBIM KNOWLEDGE FILTER',block=begin+'\n/.cbim/\n'+end;
      const a=before.indexOf(begin),b=before.indexOf(end);if((a<0)!==(b<0)||a>=0&&b<a)fail('HOST_CONFIG','ignore 托管区块损坏');
      after=a<0?before+(before&&!before.endsWith('\n')?'\n':'')+block+'\n':before.slice(0,a)+block+before.slice(b+end.length);
    }else if(relative==='.codex/config.toml'){
      const data=before?parseToml(before):{};
      // Keep all unrelated TOML and comments. A named profile narrows the selected
      // profile; older hosts may not support it and must not be called isolated.
      const old=(data.permissions as any)?.['cbim-knowledge'];
      const parent=data.default_permissions==='cbim-knowledge'?old?.extends:data.default_permissions;
      const base=typeof parent==='string'&&parent!==':danger-full-access'?parent:data.sandbox_mode==='read-only'?':read-only':':workspace';
      const begin='# BEGIN CBIM KNOWLEDGE PERMISSIONS',end='# END CBIM KNOWLEDGE PERMISSIONS';
      const a=before.indexOf(begin),b=before.indexOf(end);if((a<0)!==(b<0)||a>=0&&b<a)fail('HOST_CONFIG','权限区块损坏');
      let rest=a<0?before:before.slice(0,a)+before.slice(b+end.length);
      if(old&&a<0)fail('HOST_CONFIG','存在同名手工权限配置，已保留');
      if(/^default_permissions\s*=/m.test(rest))rest=rest.replace(/^default_permissions\s*=.*$/m,'default_permissions = "cbim-knowledge"');
      else rest='default_permissions = "cbim-knowledge"\n'+rest;
      const featureMatch=rest.match(/^\[features\][^\n]*(?:\n|$)/m);
      if(featureMatch){const start=featureMatch.index!+featureMatch[0].length;const tail=rest.slice(start);const next=tail.search(/^\[/m);let section=next<0?tail:tail.slice(0,next);
        for(const key of ['codex_hooks','hooks'])section=new RegExp('^'+key+'\\s*=','m').test(section)?section.replace(new RegExp('^'+key+'\\s*=.*$','m'),key+' = true'):key+' = true\n'+section;
        rest=rest.slice(0,start)+section+(next<0?'':tail.slice(next));
      }else if(data.features!==undefined)fail('HOST_CONFIG','features 为内联配置，需手动启用 hooks；已保留');
      else rest+='\n[features]\ncodex_hooks = true\nhooks = true\n';
      after=rest.trimEnd()+'\n\n'+begin+'\n'+stringifyToml({permissions:{'cbim-knowledge':{extends:base,filesystem:{':workspace_roots':{'.cbim':'deny'}}}}})+end+'\n';parseToml(after);
    }else{
      const errors:ParseError[]=[];const data=before?parse(before,errors):{};if(errors.length||!data||typeof data!=='object'||Array.isArray(data))fail('HOST_CONFIG','配置不是有效对象');
      const edit=(keys:string[],value:unknown)=>{after=applyEdits(after||'{}\n',modify(after||'{}\n',keys,value,{formattingOptions:{insertSpaces:true,tabSize:2}}))};
      if(data.hooks!==undefined&&(!data.hooks||typeof data.hooks!=='object'||Array.isArray(data.hooks)))fail('HOST_CONFIG','hooks 格式无效');
      const old=data.hooks?.PreToolUse||[];if(!Array.isArray(old))fail('HOST_CONFIG','PreToolUse 格式无效');
      const groups=old.map((g:any)=>{if(!g||!Array.isArray(g.hooks))fail('HOST_CONFIG','Hook 分组无效');return {...g,hooks:g.hooks.filter((h:any)=>h.statusMessage!==marker)}}).filter((g:any)=>g.hooks.length);
      const hook=relative.startsWith('.claude')?{type:'command',command:process.platform==='win32'?commands.commandWindows:commands.command,...(process.platform==='win32'?{shell:'powershell'}:{}),timeout:10,onFailure:'block',statusMessage:marker}:{type:'command',...commands,timeout:10,statusMessage:marker};
      groups.push({matcher:'.*',hooks:[hook]});edit(['hooks','PreToolUse'],groups);
      if(relative.startsWith('.claude')){
        const union=(keys:string[],values:string[])=>{let old:any=data;for(const k of keys)old=old?.[k];if(old!==undefined&&(!Array.isArray(old)||old.some((x:any)=>typeof x!=='string')))fail('HOST_CONFIG','权限规则格式无效');edit(keys,[...new Set([...(old||[]),...values])])};
        union(['permissions','deny'],['Read(./.cbim/**)','Edit(./.cbim/**)']);
        union(['sandbox','filesystem','denyRead'],['./.cbim']);union(['sandbox','filesystem','denyWrite'],['./.cbim']);
        if(process.platform!=='win32'){edit(['sandbox','enabled'],true);edit(['sandbox','allowUnsandboxedCommands'],false)}
      }
    }
    if(after!==before){if((await exists(target)?await fs.readFile(target,'utf8'):'')!==before)fail('HOST_CONFIG_CONFLICT','同步期间配置被修改');if(before)await atomic(path.join(paths.project(entry.id),'host-protection-backups',relative.replaceAll('/','_')+'.'+Date.now()+'.bak'),before);await atomic(target,after)}
  }catch(e:any){warnings.push(`${relative}: ${e.message}`)}
  return warnings;
}
