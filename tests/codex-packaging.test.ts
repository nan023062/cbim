import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageCodexRuntime} from '../scripts/package-pi-runtime.mjs';
import {codexBinary} from '../src/logic/execution/engines/codex/binary';

test('Codex 独立资源保留平台包别名，并从打包目录运行固定版本原生进程',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-codex-package-')),runtime=path.join(root,'codex-runtime'),original=(process as any).resourcesPath;
  try{
    await packageCodexRuntime(runtime);(process as any).resourcesPath=root;const binary=await codexBinary();expect(binary.startsWith(runtime+path.sep)).toBe(true);
    expect(await codexBinary({root:runtime,entry:binary,version:'0.167.0',identity:'a'.repeat(64)})).toBe(binary);
    await expect(codexBinary({root:runtime,entry:binary,version:'0.168.0',identity:'b'.repeat(64)})).rejects.toThrow(/版本/);
    expect((await promisify(execFile)(binary,['--version'],{windowsHide:true})).stdout).toContain('0.167.0');
    const manifest=JSON.parse(await fs.readFile(path.join(runtime,'manifest.json'),'utf8'));expect(manifest.packages.some((p:any)=>p.directory.split(path.sep).join('/').includes('@openai/codex-'+process.platform+'-'+process.arch))).toBe(true);
  }finally{if(original===undefined)delete (process as any).resourcesPath;else (process as any).resourcesPath=original;if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-codex-package-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150})}
},60000);
