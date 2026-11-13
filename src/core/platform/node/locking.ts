/**
 * 作用定位：Core 的 Node 原生锁入口；KernelLock：使用 Windows mutex 或 POSIX flock，防止跨进程并发持有。
 * 设计原因：用操作系统拥有的锁代替易遗留的标记文件，使进程崩溃后锁能释放。
 * 兼容边界：保留原锁命名、错误与进程内持有集合；业务选择锁范围和释放时机。
 */
import {createRequire} from 'node:module';
import path from 'node:path';
import type Koffi from 'koffi';
import fs from 'node:fs';
import {Fault} from '../../errors';
const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
const packagedNative=(process as any).resourcesPath&&path.join((process as any).resourcesPath,'koffi');
const koffi:typeof Koffi=requireNative(packagedNative&&fs.existsSync(packagedNative)?packagedNative:'koffi');
// Windows named mutexes are kernel-owned and become abandoned after a crash.
// Global namespace prevents other logon sessions silently acquiring another lock.
const win=process.platform==='win32'?koffi.load('kernel32.dll'):null;
const create=win?.func('void * __stdcall CreateMutexW(void *, int, str16)');
const wait=win?.func('uint32 __stdcall WaitForSingleObject(void *, uint32)');
const release=win?.func('int __stdcall ReleaseMutex(void *)');
const close=win?.func('int __stdcall CloseHandle(void *)');
const libc=!win?koffi.load(process.platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6'):null;
const flock=libc?.func('int flock(int, int)');
// 仅记录本进程已持有的 scope+id；旧兼容入口共享本模块，避免重复获取原生锁。
const held=new Set<string>();
/** 同步获取操作系统互斥锁；不等待、不重试，调用方负责在 finally 中释放。 */
export class KernelLock {
  private handle:any;private fd?:number;private key:string;
  /** root 须已存在；POSIX 锁该目录，Windows 使用原 Global CBIM scope/id 名称。 */
  constructor(root:string,id:string,scope='project'){
    this.key=scope+id;if(held.has(this.key))throw new Fault('LOCKED','该工程已在运行');
    if(win){this.handle=create!(null,0,`Global\\CBIM_${scope}_${id}`);
      if(!this.handle)throw new Fault('LOCK_PERMISSION','工程锁不可访问，可能由其他用户持有；拒绝重复启动');
      const result=wait!(this.handle,0);if(result!==0&&result!==128){close!(this.handle);this.handle=null;throw new Fault('LOCKED','该工程已由其他窗口或进程运行')}
    }else{this.fd=fs.openSync(root,'r');if(flock!(this.fd,6)!==0){fs.closeSync(this.fd);this.fd=undefined;throw new Fault('LOCKED','该工程已在运行')}}
    held.add(this.key);
  }
  /** 释放本实例原生句柄并移除进程内占用；业务不得在释放后继续使用原临界区。 */
  close(){if(this.handle){release!(this.handle);close!(this.handle);this.handle=null}if(this.fd!==undefined){flock!(this.fd,8);fs.closeSync(this.fd);this.fd=undefined}held.delete(this.key)}
}
