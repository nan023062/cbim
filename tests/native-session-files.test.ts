import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {NativeSessionFiles,nativeSessionByteLimit} from '../src/backend/main/platform/native-session-files';

const temporary:string[]=[];
it('Codex 原生历史核对 metadata、文件名及单一线程身份',async()=>{
  const f=await fixture(),port=new NativeSessionFiles(f.root,()=>{},'codex'),file=path.join(f.root,'rollout-native.jsonl'),session={...f.session,sessionFile:file};
  const text=JSON.stringify({type:'session_meta',payload:{id:'native',cwd:f.directory}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message'}})+'\n';
  await fs.writeFile(file,text);expect((await port.read(session,f.controller.signal)).byteLength).toBe(Buffer.byteLength(text));
  await expect(port.read({...session,nativeSessionId:'other'},f.controller.signal)).rejects.toThrow();
  await fs.appendFile(file,JSON.stringify({type:'session_meta',payload:{id:'other'}})+'\n');await expect(port.read(session,f.controller.signal)).rejects.toThrow();
  await fs.writeFile(f.file,text);await expect(port.read(f.session,f.controller.signal)).rejects.toThrow();
});
it('Claude 原生历史核实完整 JSONL、文件身份，不能混入其他会话',async()=>{
  const f=await fixture(),port=new NativeSessionFiles(f.root,()=>{},'claude-code'),text=JSON.stringify({type:'user',sessionId:'native',message:{role:'user',content:'hello'}})+'\n';
  await fs.writeFile(f.file,text);expect((await port.read(f.session,f.controller.signal)).byteLength).toBe(Buffer.byteLength(text));
  await expect(f.port.read(f.session,f.controller.signal)).rejects.toThrow();
  await fs.appendFile(f.file,JSON.stringify({type:'assistant',sessionId:'different'})+'\n');await expect(port.read(f.session,f.controller.signal)).rejects.toThrow();
  await fs.writeFile(f.file,text.trimEnd());await expect(port.read(f.session,f.controller.signal)).rejects.toThrow();
});
afterEach(async()=>{vi.restoreAllMocks();for(const directory of temporary.splice(0)){const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(directory));if(!relative.startsWith('cbim-native-checkpoint-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unexpected fixture cleanup path');await fs.rm(directory,{recursive:true,force:true})}});
async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-native-checkpoint-'));temporary.push(directory);const root=path.join(directory,'sessions');await fs.mkdir(root);const file=path.join(root,'native.jsonl'),text=JSON.stringify({type:'session',id:'native',version:3})+'\n'+JSON.stringify({type:'message',id:'m',message:{role:'assistant',content:[{type:'text',text:'真实会话正文'}]}})+'\n';await fs.writeFile(file,text);const controller=new AbortController(),port=new NativeSessionFiles(root,()=>{}),session={nativeSessionId:'native',sessionFile:file};return {directory,root,file,text,controller,port,session}}

it('只读核实原生会话字节，返回指纹不暴露正文或私有路径且不改写文件',async()=>{
  const f=await fixture(),before=await fs.stat(f.file),result=await f.port.read(f.session,f.controller.signal),after=await fs.stat(f.file);
  expect(result).toEqual({byteLength:Buffer.byteLength(f.text),sha256:createHash('sha256').update(f.text).digest('hex')});expect(after.mtimeMs).toBe(before.mtimeMs);expect(await fs.readFile(f.file,'utf8')).toBe(f.text);expect(JSON.stringify(result)).not.toContain('真实会话正文');expect(JSON.stringify(result)).not.toContain(f.file);
  await fs.appendFile(f.file,JSON.stringify({type:'message',id:'extra'})+'\n');expect((await f.port.read(f.session,f.controller.signal)).sha256).not.toBe(result.sha256);
});

it('缺失、越出固定根、错误原生身份以及目录均不能作为续执行证明',async()=>{
  const f=await fixture(),outside=path.join(f.directory,'outside.jsonl');await fs.writeFile(outside,f.text);
  for(const session of [{nativeSessionId:'native'},{...f.session,nativeSessionId:'foreign'},{...f.session,sessionFile:outside},{...f.session,sessionFile:f.root}])await expect(f.port.read(session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});
  await expect(f.port.read({...f.session,sessionFile:path.join(f.root,'absent.jsonl')},f.controller.signal)).rejects.toThrow();
});

it('损坏UTF8、尾行、JSONL或非对象header不能被截断或修复后当有效记录',async()=>{
  const f=await fixture();
  const malformed=[Buffer.from(f.text.trimEnd()),Buffer.from(f.text+'{unfinished}\n'),Buffer.from('null\n'),Buffer.from('[]\n'),Buffer.from('42\n'),Buffer.from(JSON.stringify({type:'session',id:'native'})+'\nnull\n'),Buffer.concat([Buffer.from(JSON.stringify({type:'session',id:'native'})+'\n'),Buffer.from([0xff,0x0a])])];
  for(const bytes of malformed){await fs.writeFile(f.file,bytes);await expect(f.port.read(f.session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});expect(await fs.readFile(f.file)).toEqual(bytes)}
});

it('拒绝硬链接及通过目录联接进入的会话，不触及链接目标内容',async()=>{
  const f=await fixture(),linked=path.join(f.root,'hard.jsonl');await fs.link(f.file,linked);
  await expect(f.port.read(f.session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});await expect(f.port.read({...f.session,sessionFile:linked},f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});
  await fs.unlink(linked);const outside=path.join(f.directory,'external');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'native.jsonl'),f.text);const junction=path.join(f.root,'junction');await fs.symlink(outside,junction,process.platform==='win32'?'junction':'dir');
  await expect(f.port.read({...f.session,sessionFile:path.join(junction,'native.jsonl')},f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});expect(await fs.readFile(path.join(outside,'native.jsonl'),'utf8')).toBe(f.text);
});

it('超过字节或条数上限时拒绝，不把前缀摘要当作完整会话',async()=>{
  const f=await fixture();await fs.truncate(f.file,nativeSessionByteLimit+1);await expect(f.port.read(f.session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});
  await fs.writeFile(f.file,JSON.stringify({type:'session',id:'native'})+'\n'+(JSON.stringify({type:'message'})+'\n').repeat(100000));await expect(f.port.read(f.session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});
});

it.runIf(process.platform==='win32')('Windows备用数据流不属于受管原生会话文件',async()=>{
  const f=await fixture(),alternate=f.file+':hidden';await fs.writeFile(alternate,f.text);
  await expect(f.port.read({...f.session,sessionFile:alternate},f.controller.signal)).rejects.toThrow();
  expect(await fs.readFile(f.file,'utf8')).toBe(f.text);
});

it('检查与打开之间真实外部追加不能获得有效指纹，重新显式读取才核实新内容',async()=>{
  const f=await fixture(),open=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementationOnce(async(file,flags,mode)=>{const handle=await open(file,flags,mode);await fs.appendFile(f.file,JSON.stringify({type:'message',id:'concurrent'})+'\n');return handle});
  await expect(f.port.read(f.session,f.controller.signal)).rejects.toMatchObject({code:'MEMBER_CHECKPOINT_NATIVE'});
  vi.restoreAllMocks();const bytes=await fs.readFile(f.file);expect(await f.port.read(f.session,f.controller.signal)).toEqual({byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
});

it('停止和工作区退役检查覆盖读取，拒绝后文件仍可由正常只读入口核实',async()=>{
  const f=await fixture();f.controller.abort(Error('fixture stopped'));await expect(f.port.read(f.session,f.controller.signal)).rejects.toThrow('fixture stopped');
  let checks=0;const retired=new NativeSessionFiles(f.root,()=>{if(++checks===2)throw Error('fixture retired')});await expect(retired.read(f.session,new AbortController().signal)).rejects.toThrow('fixture retired');expect(checks).toBe(2);
  expect((await f.port.read(f.session,new AbortController().signal)).byteLength).toBe(Buffer.byteLength(f.text));
});
