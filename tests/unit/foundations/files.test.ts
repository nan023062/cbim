import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomic,exists,readJson} from '../../../src/backend/core/foundation/files';
import {tempDirectory} from '../../support/temp-directory';

it('创建父目录，替换完整 UTF-8 JSON；读取不暗中验证业务 Schema',async()=>{
  const f=await tempDirectory();try{
    const file=path.join(f.root,'nested','value.json');expect(await exists(file)).toBe(false);
    await atomic(file,JSON.stringify({text:'正文😀'}));expect(await readJson(file)).toEqual({text:'正文😀'});
    await atomic(file,'42');expect(await readJson(file)).toBe(42);expect(await fs.readdir(path.dirname(file))).toEqual(['value.json']);
    await atomic(file,'bad');await expect(readJson(file)).rejects.toThrow();
  }finally{await f.cleanup()}
});
it('写入失败关闭句柄、清理独占临时文件并保留原目标',async()=>{
  const f=await tempDirectory();const realOpen=fs.open;let spy:{mockRestore():void}|undefined;
  try{
    const file=path.join(f.root,'value');await fs.writeFile(file,'old');
    spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
      const handle=await realOpen(...args);handle.writeFile=async()=>{throw Error('disk full')};return handle;
    });
    await expect(atomic(file,'new')).rejects.toThrow('disk full');spy.mockRestore();
    expect(await fs.readFile(file,'utf8')).toBe('old');expect(await fs.readdir(f.root)).toEqual(['value']);
  }finally{spy?.mockRestore();await f.cleanup()}
});
it('替换失败不留下临时文件，不把目录替换为文件',async()=>{
  const f=await tempDirectory();try{
    const target=path.join(f.root,'occupied');await fs.mkdir(target);
    await expect(atomic(target,'new')).rejects.toThrow();expect((await fs.stat(target)).isDirectory()).toBe(true);
    expect(await fs.readdir(f.root)).toEqual(['occupied']);
  }finally{await f.cleanup()}
});
