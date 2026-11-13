import {expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {KernelLock} from '../src/core/platform/node/locking';
import {KernelLock as LegacyLock} from '../src/backend/main/platform/locking';

it('旧入口与 Core 共用构造器和原生锁，释放后可重新获取',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-lock-migration-')),id=randomUUID();
  let lock:KernelLock|undefined;
  try{
    expect(LegacyLock).toBe(KernelLock);
    lock=new KernelLock(root,id,'migration');
    expect(()=>new LegacyLock(root,id,'migration')).toThrow(expect.objectContaining({code:'LOCKED'}));
    lock.close();lock=undefined;
    lock=new LegacyLock(root,id,'migration');
  }finally{
    lock?.close();fs.rmdirSync(root);
  }
});
