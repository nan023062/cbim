import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {latestExecutable} from './build-artifact.mjs';

// 组合当前对话区、侧栏、扩展区和运行时的真实桌面测试，避免沿用已删除的顶部页签和外部服务 UI。
const executable=await latestExecutable(),startedAt=new Date().toISOString(),results=[];
await fs.mkdir('test-results',{recursive:true});
try{
  for(const script of ['sidebar-smoke.mjs','extensions-smoke.mjs','runtime-smoke.mjs','loop-smoke.mjs']){
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['scripts/'+script],{env:{...process.env,CBIM_TEST_EXE:executable},windowsHide:true,stdio:'inherit'});
      child.on('error',reject);child.on('exit',code=>resolve({script,code,passed:code===0}));
    });
    results.push(result);if(!result.passed)throw Error('桌面验证失败：'+script+'（退出码 '+result.code+'）');
  }
  console.log(JSON.stringify({packagedExecutable:executable,passed:true,results}));
}finally{
  await fs.writeFile('test-results/desktop.json',JSON.stringify({packagedExecutable:executable,startedAt,completedAt:new Date().toISOString(),passed:results.length===4&&results.every(result=>result.passed),results},null,2));
}
