// 离线修复已确认的单条旧工具结果；默认只预览，不调用模型、不重放工具。
// 备份和回执放在 sessions 的同级目录，避免被 Pi 当作另一份会话加载。
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const code='LEGACY_TOOL_RESULT_INVALID';
function problem(message){throw Error(message)}

/** 只返回 PID 以核对停止状态，不读取或输出其他进程参数。检测失败时拒绝写入。 */
export async function assertNoActiveCbim(){
  const command=process.platform==='win32'?'powershell.exe':'ps';
  const args=process.platform==='win32'
    ?['-NoLogo','-NoProfile','-NonInteractive','-Command',"$items = @(Get-Process -Name CBIM -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id); ConvertTo-Json -InputObject $items -Compress"]
    :['-A','-o','pid=,comm='];
  const output=await new Promise((resolve,reject)=>execFile(command,args,{windowsHide:true,encoding:'utf8',timeout:10000},(error,stdout)=>error?reject(Error('无法核对 CBIM 进程状态，未修改会话')):resolve(stdout)));
  let pids;
  try{pids=process.platform==='win32'?JSON.parse(String(output).trim()||'[]'):String(output).split('\n').filter(line=>/\bCBIM(?: Assistant)?$/i.test(line)).map(line=>Number(line.trim().split(/\s+/)[0]));}
  catch{problem('无法解析 CBIM 进程状态，未修改会话')}
  if(!Array.isArray(pids)||pids.some(pid=>!Number.isInteger(pid)||pid<=0))problem('CBIM 进程状态无效，未修改会话');
  if(pids.length)problem('CBIM 仍在运行，请先退出应用后修复会话');
}

function replacementText(recordId,toolCallId){return JSON.stringify({error:{code,message:'旧版本工具返回缺少文本的无效结果；原记录不能证明取消成功。本次只修复历史格式，未重新执行取消操作。'},recovery:{recordId,toolCallId,replayed:false}})}

/** 只允许指定 cbim_task_cancel 记录恰好缺少 text；其他异常交给人工核对。 */
function plan(original,recordId,toolCallId){
  const text=original.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(original))problem('会话不是有效 UTF-8，未修改');
  const lines=text.split(/(?<=\n)/),matches=[],invalid=[];
  for(let index=0;index<lines.length;index++){
    const line=lines[index].replace(/\r?\n$/,'').replace(index===0?/^\uFEFF/:/$^/,'');
    if(!line.trim())continue;
    let record;try{record=JSON.parse(line)}catch{problem(`会话第 ${index+1} 行不是有效 JSON，未修改`)}
    if(record?.id===recordId)matches.push({record,index});
    if(Array.isArray(record?.message?.content))for(const block of record.message.content){
      if(block?.type==='text'&&typeof block.text!=='string')invalid.push({recordId:record.id,index});
    }
  }
  if(matches.length!==1)problem('目标记录不存在或 ID 不唯一，未修改');
  const {record,index}=matches[0],message=record.message;
  if(record.type!=='message'||message?.role!=='toolResult'||message.toolName!=='cbim_task_cancel'||message.toolCallId!==toolCallId)problem('目标记录与已确认的取消工具结果不一致，未修改');
  const repairedText=replacementText(recordId,toolCallId);
  if(message.isError===true&&Array.isArray(message.content)&&message.content.length===1&&message.content[0]?.type==='text'&&message.content[0].text===repairedText){
    if(invalid.length)problem('会话仍有其他异常文本块，未修改');
    return {status:'already_repaired',line:index+1};
  }
  if(message.isError!==false||!Array.isArray(message.content)||message.content.length!==1||message.content[0]?.type!=='text'||Object.keys(message.content[0]).join(',')!=='type')problem('目标记录不符合已确认的缺失文本故障，未修改');
  if(invalid.length!==1||invalid[0].index!==index)problem('会话包含其他异常文本块，拒绝批量修复');
  message.content=[{type:'text',text:repairedText}];message.isError=true;
  const eol=lines[index].endsWith('\r\n')?'\r\n':lines[index].endsWith('\n')?'\n':'';
  const bom=index===0&&lines[index].startsWith('\uFEFF')?'\uFEFF':'';
  lines[index]=bom+JSON.stringify(record)+eol;
  return {status:'would_repair',line:index+1,bytes:Buffer.from(lines.join(''),'utf8')};
}

async function durableWrite(file,bytes){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}}

/**
 * apply 必须携带 dry-run 得到的 SHA-256；原文件在备份后与替换前都复核。
 * assertIdle 仅供隔离测试注入；CLI 固定核对真实进程，不提供绕过开关。
 * 临时互斥文件阻止本脚本并发执行；离线检查不宣称能锁住任意外部编辑器。
 */
export async function repairPiToolResult({sessionFile,recordId,toolCallId,expectedSha256,apply=false},{assertIdle=assertNoActiveCbim}={}){
  if(!sessionFile||!recordId||!toolCallId)problem('需要明确会话路径、记录 ID 和工具调用 ID');
  const requested=path.resolve(sessionFile),stat=await fs.lstat(requested);
  if(!stat.isFile()||stat.isSymbolicLink()||path.extname(requested)!=='.jsonl')problem('只能修复普通 JSONL 会话文件');
  if(stat.size>64*1024*1024)problem('会话文件超过离线修复大小限制');
  const directory=await fs.realpath(path.dirname(requested));
  if(path.basename(directory)!=='sessions')problem('目标文件必须位于 Pi sessions 目录');
  const file=path.join(directory,path.basename(requested)),original=await fs.readFile(file),beforeSha256=sha256(original);
  const planned=plan(original,recordId,toolCallId);
  const metadata={sessionFile:file,recordId,toolCallId,line:planned.line,beforeSha256,afterSha256:planned.bytes?sha256(planned.bytes):beforeSha256};
  if(planned.status==='already_repaired')return {...metadata,status:'already_repaired'};
  if(!apply)return {...metadata,status:'would_repair'};
  if(!/^[a-f0-9]{64}$/.test(expectedSha256||'')||expectedSha256!==beforeSha256)problem('会话与预览哈希不一致，请重新核对，未修改');
  await assertIdle();
  const lock=file+'.repair.lock',lockHandle=await fs.open(lock,'wx',0o600);
  const repairId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const backupDirectory=path.join(path.dirname(directory),'session-repair-backups',path.basename(file)+'-'+repairId);
  const temporary=path.join(directory,'.repair-'+randomUUID()+'.tmp');
  let manifest;
  try{
    if(sha256(await fs.readFile(file))!==beforeSha256)problem('会话在准备修复时发生变化，未修改');
    await fs.mkdir(backupDirectory,{recursive:true,mode:0o700});
    const backupFile=path.join(backupDirectory,'original.jsonl.backup');
    await durableWrite(backupFile,original);
    if(sha256(await fs.readFile(backupFile))!==beforeSha256)problem('原始备份校验失败，未修改会话');
    manifest={...metadata,repairId,createdAt:new Date().toISOString(),status:'prepared',code,backupFile,changedRecordIds:[recordId],replayed:false};
    await durableWrite(path.join(backupDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await durableWrite(temporary,planned.bytes);
    await assertIdle();
    const currentStat=await fs.lstat(file);
    if(!currentStat.isFile()||currentStat.isSymbolicLink()||sha256(await fs.readFile(file))!==beforeSha256)problem('会话在备份后发生变化，未覆盖原文件；备份已保留');
    await fs.rename(temporary,file);
    if(sha256(await fs.readFile(file))!==metadata.afterSha256)problem('替换后的会话哈希不一致，请使用备份核对');
    const receipt={...manifest,status:'repaired',completedAt:new Date().toISOString()};
    await durableWrite(path.join(backupDirectory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  }finally{
    await fs.rm(temporary,{force:true});await lockHandle.close();await fs.rm(lock,{force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{session:{type:'string'},'record-id':{type:'string'},'tool-call-id':{type:'string'},'expected-sha256':{type:'string'},apply:{type:'boolean'}}});
    const result=await repairPiToolResult({sessionFile:values.session,recordId:values['record-id'],toolCallId:values['tool-call-id'],expectedSha256:values['expected-sha256'],apply:values.apply});
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error instanceof Error?error.message:'会话修复失败');process.exitCode=1}
}
