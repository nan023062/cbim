import fs from 'node:fs/promises';
import path from 'node:path';
export async function latestExecutable(){
  const supplied=process.env.CBIM_TEST_EXE;
  if(supplied){const executable=path.resolve(supplied);await fs.access(executable);return executable}
  let info;try{info=JSON.parse(await fs.readFile('build/latest-build.json','utf8'))}catch{throw Error('请先运行 pnpm package 或 pnpm make，或设置 CBIM_TEST_EXE 指定待验证的程序')}
  if(info.platform!=='win32'||typeof info.executable!=='string')throw Error('最近构建不是 Windows 可执行程序，请设置 CBIM_TEST_EXE');
  await fs.access(info.executable);return info.executable;
}
