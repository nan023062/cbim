import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {buildWebsite} from './build-website.mjs';

// 独立 CI runner 的回环服务；浏览器仍由原 14 场景脚本管理，不连接用户浏览器。
await buildWebsite();
const server = spawn(process.execPath,['scripts/preview-website.mjs'],{stdio:['ignore','inherit','inherit','ipc'],windowsHide:true,env:{...process.env,CBIM_WEBSITE_PORT:'0'}});
const closed = once(server,'exit');
let timer;
try {
  const message = await Promise.race([
    once(server,'message').then(([message])=>message),
    closed.then(()=>{throw Error('Website preview exited before readiness')}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Website preview did not become ready')),10000)}),
  ]);
  clearTimeout(timer);
  const url = message?.url;
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) throw Error('Invalid preview receipt');
  const browser = spawn(process.execPath,['scripts/website-smoke.mjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,CBIM_WEBSITE_TEST_URL:url}});
  const [code] = await once(browser,'exit');
  if (code !== 0) throw Error('Website browser checks failed: ' + code);
} finally {
  clearTimeout(timer);
  if (server.exitCode === null) server.kill();
  await closed;
}
