/**
 * 作用定位：对显式知识库访问和部分路径别名做前置拒绝；属于防误操作策略而非 OS 沙箱。
 * 设计原因：让外部宿主 Hook 与内部 Loop 复用访问判断，减少两条执行路径的保护差异。
 */
import path from 'node:path';
import fs from 'node:fs';
export function guard(event:any,root:string,workspaceId:string):string|undefined {
  if(event?.hook_event_name!=='PreToolUse')return 'CBIM Hook 收到不支持的事件，拒绝执行';
  const name=String(event.tool_name||'');
  if(/^mcp__/i.test(name)&&name.includes(workspaceId)&&/cbim/i.test(name))return;
  const input=event.tool_input??{};
  const encoded=typeof input==='string'?input:JSON.stringify(input);
  const normalized=encoded.replace(/\\/g,'/').replace(/%2e/gi,'.').replace(/%2f|%5c/gi,'/').toLowerCase();
  if(normalized.includes('.cbim'))return 'CBIM 知识库禁止宿主直接访问，请使用本工作区 CBIM MCP 查询或 CRUD 工具';
  const protectedRoot=path.resolve(root,'.cbim');
  const within=(p:string)=>{const rel=path.relative(protectedRoot,p);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel))};
  const check=(value:any):boolean=>{
    if(!value||typeof value!=='object')return false;
    return Object.entries(value).some(([key,v])=>{
      if(typeof v==='string'&&/^(file_path|path|cwd|workdir|directory|target|source|destination|notebook_path)$/i.test(key)){
        let p=path.resolve(event.cwd||root,v);if(within(p))return true;
        try{p=fs.realpathSync(p);if(within(p))return true}catch{}
      }
      return typeof v==='object'&&check(v);
    });
  };
  if(check(input)||within(path.resolve(event.cwd||root)))return 'CBIM Hook 拒绝通过路径或链接访问知识库，请使用 CBIM MCP';
  // Broad native search tools may include protected descendants even without naming them.
  // 非递归 ls 仅列出目录项；可以发现业务目录，但上述路径检查仍禁止进入知识库。
  if(/^ls$/i.test(name)&&!input.recursive)return;
  if(/^(Read|Edit|Write|Glob|Grep|LS|List|NotebookEdit)$/i.test(name)){
    const p=path.resolve(event.cwd||root,input.path||input.file_path||root);
    const rel=path.relative(p,protectedRoot);
    if(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)))return '请把文件操作范围限定到业务目录，工作区根搜索可能包含 CBIM 知识库';
  }
  if(/^(Bash|PowerShell|exec_command|shell_command|shell)$/i.test(name)){
    const command=String(input.command||input.cmd||'');
    if(/(?:^|[;&|\n])\s*(?:rg|grep|find|Get-ChildItem|Select-String)\b/i.test(command)&&!/(?:src|Client|Assets|tests)[/\\]/i.test(command))return '请把搜索限定到明确的业务目录，避免递归扫描工作区知识库';
  }
  return;
}
