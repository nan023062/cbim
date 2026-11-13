/**
 * 作用定位：对显式知识库访问和部分路径别名做前置拒绝；属于防误操作策略而非 OS 沙箱。
 * 设计原因：按完整路径段识别知识目录，不把业务文件名或正文中的 .cbim 子串当成访问；命令仅对可确认的 stdin grep 放行，未知搜索仍收窄范围。
 */
import path from 'node:path';
import fs from 'node:fs';
/** 返回拒绝原因；调用者在通过后仍需应用本次运行的副作用授权。root 固定为所属工作区。 */
export function guard(call:{name:string;input:unknown},root:string):string|undefined {
  const name=call.name;
  const input:any=call.input??{};
  const normalize=(value:string)=>value.replace(/\\/g,'/').replace(/%2e/gi,'.').replace(/%2f|%5c/gi,'/').toLowerCase();
  const knowledgeSegment=(value:string)=>/(?:^|[\/\s"'`=:;|&()<>])\.cbim(?:[\/\s"'`;|&()<>]|$)/.test(normalize(value));
  // 已知文件工具只检查定位字段；文件正文、替换文本和搜索模式不是访问目标。
  const fileTool=/^(read|edit|write|glob|grep|find|ls|list|notebookedit)$/i.test(name);
  if(!fileTool&&knowledgeSegment(typeof input==='string'?input:JSON.stringify(input)))return '原生工具禁止直接访问 CBIM 知识库，请使用本工作区的 cbim_ 知识查询或 CRUD 工具';
  const protectedRoot=path.resolve(root,'.cbim');
  const within=(p:string)=>{const rel=path.relative(protectedRoot,p);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel))};
  const check=(value:any):boolean=>{
    if(!value||typeof value!=='object')return false;
    return Object.entries(value).some(([key,v])=>{
      if(typeof v==='string'&&/^(file_path|path|cwd|workdir|directory|target|source|destination|notebook_path)$/i.test(key)){
        if(knowledgeSegment(v))return true;
        let p=path.resolve(root,v);if(within(p))return true;
        try{p=fs.realpathSync(p);if(within(p))return true}catch{}
      }
      return typeof v==='object'&&check(v);
    });
  };
  if(check(input)||within(path.resolve(root)))return '禁止通过路径或链接绕过知识库保护，请使用 cbim_ 知识工具';
  // Broad native search tools may include protected descendants even without naming them.
  // 非递归 ls 仅列出目录项；可以发现业务目录，但上述路径检查仍禁止进入知识库。
  if(/^ls$/i.test(name)&&!input.recursive)return;
  if(/^(Read|Edit|Write|Glob|Grep|LS|List|NotebookEdit)$/i.test(name)){
    const p=path.resolve(root,input.path||input.file_path||root);
    const rel=path.relative(p,protectedRoot);
    if(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)))return '请把文件操作范围限定到业务目录，工作区根搜索可能包含 CBIM 知识库';
  }
  if(/^(Bash|PowerShell|exec_command|shell_command|shell)$/i.test(name)){
    const command=String(input.command||input.cmd||'');
    // 只移除单管道、单模式且没有文件/重定向/展开的 grep；grep pattern . 与 || grep 仍需检查。
    const searches=command.replace(/(?<!\|)\|(?!\|)\s*grep\s+(?:(?:-[iEnovwxcF]+|--)\s+)*(?:"[^"$`\\]*"|'[^']*'|[^\s;&|<>()$`\\-][^\s;&|<>()$`\\]*)\s*(?=$|[;|\r\n])/g,'| stdin_filter ');
    if(/(?:^|[;&|\n])\s*(?:rg|grep|find|Get-ChildItem|Select-String)\b/i.test(searches)&&!/(?:src|Client|Assets|tests)[/\\]/i.test(searches))return '请把搜索限定到明确的业务目录（如 src/），避免递归扫描工作区知识库；仅过滤标准输入时使用不带文件参数的管道 grep';
  }
  return;
}
