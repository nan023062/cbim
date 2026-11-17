import {test,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import path from 'node:path';
const load=createRequire(import.meta.url),execute=promisify(execFile);
test('tsx 命令能加载 ESM 构建入口并在任何写入前拒绝未知引擎',async()=>{
  let failure:any;
  try{await execute(process.execPath,[load.resolve('tsx/cli'),path.resolve('scripts/make-engines.ts'),'not-an-official-engine'],{windowsHide:true,maxBuffer:2*1024*1024})}catch(error){failure=error}
  expect(failure?.code).toBe(1);expect(failure.stderr).toContain('Invalid enum value');expect(failure.stderr).toContain('memory');
  expect(failure.stderr).not.toContain('ERR_REQUIRE_ASYNC_MODULE');expect(failure.stderr).not.toContain('Top-level await');
},15000);
