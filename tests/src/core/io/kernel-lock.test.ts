import {expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {KernelLock} from '../../../../src/core/io/locking';

it('同一身份无法重复持锁，释放后可重新获取',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cbim-lock-migration-')),id=randomUUID();
  let lock:KernelLock|undefined;
  try{
    lock=new KernelLock(root,id,'migration');
    expect(()=>new KernelLock(root,id,'migration')).toThrow(expect.objectContaining({reason:'busy'}));
    lock.Close();lock=undefined;
    lock=new KernelLock(root,id,'migration');
  }finally{
    lock?.Close();fs.rmdirSync(root);
  }
});
