// 隔离测试的只读映射持有者：只映射父进程指定的自有普通文件，绝不写文件或业务日志。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const root=fs.realpathSync(config.root),file=fs.realpathSync(config.file);
assert.ok(path.basename(root).startsWith('cbim-controlled-file-'));
assert.ok(file.startsWith(root+path.sep));assert.equal(fs.lstatSync(config.file).isSymbolicLink(),false);assert.ok(fs.statSync(file).isFile());
assert.equal(require.resolve('koffi'),config.koffiPath);
const koffi=require('koffi'),kernel=koffi.load('kernel32.dll');
const open=kernel.func('void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)');
const mapping=kernel.func('void * __stdcall CreateFileMappingW(void *,void *,uint32,uint32,uint32,str16)');
const view=kernel.func('void * __stdcall MapViewOfFile(void *,uint32,uint32,uint32,uintptr)');
const unmap=kernel.func('int __stdcall UnmapViewOfFile(void *)'),close=kernel.func('int __stdcall CloseHandle(void *)'),lastError=kernel.func('uint32 __stdcall GetLastError()');
let handle,mapped,pointer;
function invalid(value){return !value||koffi.address(value)===0xffffffffffffffffn}
function send(value){process.stdout.write(JSON.stringify(value)+'\n')}
function cleanup(){if(pointer){assert.ok(unmap(pointer),'UnmapViewOfFile '+lastError());pointer=undefined}if(mapped){assert.ok(close(mapped),'CloseHandle mapping '+lastError());mapped=undefined}if(handle){assert.ok(close(handle),'CloseHandle file '+lastError());handle=undefined}}
try{
  handle=open(file,0x80000000,7,null,3,0x80,null);if(invalid(handle))throw Error('CreateFileW '+lastError());
  mapped=mapping(handle,null,2,0,0,null);if(!mapped)throw Error('CreateFileMappingW '+lastError());
  pointer=view(mapped,4,0,0,0);if(!pointer)throw Error('MapViewOfFile '+lastError());
  assert.ok(close(handle),'CloseHandle file '+lastError());handle=undefined;
  send({kind:'mapped',pid:process.pid,file,readonly:true,originalFileHandleClosed:true});
  process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>{input+=chunk;let newline;while((newline=input.indexOf('\n'))>=0){const message=JSON.parse(input.slice(0,newline));input=input.slice(newline+1);assert.equal(message.kind,'release');cleanup();send({kind:'released',pid:process.pid});process.exit(0)}});
  process.stdin.on('end',()=>{cleanup();process.exit(0)});
}catch(error){try{cleanup()}catch{}send({kind:'error',error:String(error)});process.exit(1)}
