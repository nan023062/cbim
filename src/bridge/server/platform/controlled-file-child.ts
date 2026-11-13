/**
 * 目录归属：bridge/server/platform；受控文件、产物读取与验证平台。
 * 作用定位：独立 Electron utility 文件工人入口，只接收固定私有消息，不启动 Application 或模型。
 * 设计原因：同步 Win32 与 GetLastError 留在同线程；父进程可靠保存 executing 后才发送一次内容替换或冻结的删除/移动。
 */
import {controlledChildRequestSchema,type ControlledChildReply} from '../../../logic/file-operations/platform/files/controlled-file-protocol';
import {Win32ControlledFile} from '../../../logic/file-operations/platform/files/controlled-file-win32';
import {createHash} from 'node:crypto';

const port=(process as NodeJS.Process&{parentPort?:{on(name:'message',listener:(event:{data:unknown})=>void):void;postMessage(value:unknown):void}}).parentPort;
if(!port)throw Error('受控文件入口只能由 utilityProcess 启动');
let file:Win32ControlledFile|undefined,token:string|undefined,lastSeq=0,used=false;
const send=(value:ControlledChildReply)=>port.postMessage(value);
let idle:ReturnType<typeof setTimeout>;
const renew=()=>{clearTimeout(idle);idle=setTimeout(()=>{try{file?.close()}finally{process.exit(1)}},60_000)};renew();
port.on('message',event=>{
  const parsed=controlledChildRequestSchema.safeParse(event.data);
  if(!parsed.success){try{file?.close()}finally{process.exit(1)}return}
  const input=parsed.data;
  if(input.seq!==lastSeq+1||token!==undefined&&input.token!==token){try{file?.close()}finally{process.exit(1)}return}
  token=input.token;lastSeq=input.seq;renew();
  try{
    if(input.kind==='close'){file?.close();file=undefined;send({kind:'closed',token,seq:lastSeq});setImmediate(()=>process.exit(0));return}
    if(input.kind==='open'){
      if(file||lastSeq!==1)throw Object.assign(Error('CONTROLLED_SESSION_USED'),{code:'CONTROLLED_SESSION_USED'});
      file=new Win32ControlledFile(input.root,input.relativePath,input.protectedRoots,input.koffiPath,input.transition);const result=file.read();send({kind:'opened',token,seq:lastSeq,identity:result.identity,fact:result.fact,bytes:result.bytes.toString('base64')});return;
    }
    if(!file)throw Object.assign(Error('CONTROLLED_SESSION_CLOSED'),{code:'CONTROLLED_SESSION_CLOSED'});
    if(input.kind==='recheck'){const result=file.read();send({kind:'checked',token,seq:lastSeq,identity:result.identity,fact:result.fact});return}
    if(used)throw Object.assign(Error('CONTROLLED_SESSION_USED'),{code:'CONTROLLED_SESSION_USED'});used=true;
    if(input.kind==='transition'){const result=file.transition();send({kind:'transitioned',token,seq:lastSeq,...result});return}
    const bytes=Buffer.from(input.bytes,'base64');if(bytes.toString('base64')!==input.bytes||bytes.length!==input.expected.byteLength||createHash('sha256').update(bytes).digest('hex')!==input.expected.sha256)throw Object.assign(Error('CONTROLLED_INPUT'),{code:'CONTROLLED_INPUT'});
    const result=file.replace(bytes);send({kind:'applied',token,seq:lastSeq,identity:result.identity,fact:result.fact});
  }catch(error){const code=(error as {code?:string})?.code;send({kind:'error',token,seq:lastSeq,code:code&&/^[A-Z0-9_]{1,80}$/.test(code)?code:'CONTROLLED_IO_FAILED',writeIssued:file?.writeIssued??false})}
});
