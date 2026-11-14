import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {managedNativeTools,nativeToolInput} from '../src/logic/execution/engines/native-tools';

test.each(['read','write','edit','find','grep','ls'])('Windows %s 根相对路径与工作区盘符一致，不修改原参数',name=>{
  for(const target of ['/tmp/截图.png','\\tmp\\截图.png']){
    const input={path:target,content:'unchanged'};
    expect(nativeToolInput(name,input,'D:\\project','win32')).toEqual({path:'D:\\tmp\\截图.png',content:'unchanged'});
    expect(input.path).toBe(target);
  }
});
test('完整路径、UNC、普通相对路径、非文件工具和 POSIX 路径保持原语义',()=>{
  for(const target of ['C:\\tmp\\shot.png','D:/tmp/shot.png','\\\\server\\share\\shot.png','//server/share/shot.png','src/file.ts']){
    const input={path:target};expect(nativeToolInput('read',input,'D:\\project','win32')).toBe(input);
  }
  const input={path:'/tmp/file',command:'echo test'};
  expect(nativeToolInput('bash',input,'D:\\project','win32')).toBe(input);
  expect(nativeToolInput('write',input,'/work/project','linux')).toBe(input);
});
test('受管原生工具按同一目标完成写入、读取和编辑',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-native-path-'));
  try{
    const tools=await managedNativeTools(root),file=path.join(root,'中文.txt');
    const target=process.platform==='win32'?file.slice(path.parse(file).root.length-1):file;
    const signal=new AbortController().signal;
    await tools.call('write',{path:target,content:'first'},signal,'write');
    expect(await fs.readFile(file,'utf8')).toBe('first');
    await tools.call('edit',{path:target,edits:[{oldText:'first',newText:'second'}]},signal,'edit');
    const result=await tools.call('read',{path:target},signal,'read');
    expect(JSON.stringify(result)).toContain('second');
  }finally{
    if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-native-path-'))throw Error('Unexpected cleanup path');
    await fs.rm(root,{recursive:true,force:true});
  }
});
