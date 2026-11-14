import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {TerminalSessions} from '../src/logic/terminal/service/terminal';
test('manual terminal captures output and exit status without sharing sessions',async()=>{
 const terminals=new TerminalSessions(),started=performance.now();let slowSnapshot:ReturnType<TerminalSessions['read']>|undefined,completionSnapshot:ReturnType<TerminalSessions['read']>|undefined;
 // 本项验证真实输出、退出码和会话隔离；Windows PowerShell 冷启动耗时不属于产品完成条件。
 // 独立 Windows runner 的首次启动曾连续两轮超过 30 秒；本测试不约束系统冷启动性能。
 // 保留十秒状态与最终耗时，最多观察两分钟；不重试命令、不放宽输出/退出码/隔离断言。
 const slowTimer=setTimeout(()=>{slowSnapshot=terminals.read('one');console.log('TERMINAL_TEN_SECONDS',JSON.stringify(slowSnapshot))},10000);
 try{
 terminals.start('one',process.cwd(),process.platform==='win32'?"Write-Output 'TERMINAL_OK'":"printf TERMINAL_OK");
 await expect.poll(()=>terminals.read('one'),{timeout:120000}).toMatchObject({running:false,exitCode:0});
 completionSnapshot=terminals.read('one');
 expect(terminals.read('one')).toMatchObject({exitCode:0});expect(terminals.read('one').output).toContain('TERMINAL_OK');expect(terminals.read('other').output).toBe('');terminals.close('one');expect(terminals.read('one').output).toBe('');
 }finally{clearTimeout(slowTimer);const evidence={elapsedMs:performance.now()-started,slowSnapshot,completionSnapshot,finalSnapshot:terminals.read('one')};console.log('TERMINAL_COMPLETION',JSON.stringify(evidence));try{await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/terminal-state.json',JSON.stringify(evidence,null,2))}finally{terminals.closeAll()}}
},135000);

test('manual terminal keeps a failing Unicode command readable with its nonzero exit',async()=>{
 const terminals=new TerminalSessions();
 try{
  terminals.start('failure',process.cwd(),process.platform==='win32'?"throw '失败中文'":"printf '失败中文' >&2; exit 1");
  await expect.poll(()=>terminals.read('failure'),{timeout:30000}).toMatchObject({running:false,exitCode:1});
  expect(terminals.read('failure').output).toContain('失败中文');expect(terminals.read('failure').output).not.toContain('CLIXML');
 }finally{terminals.closeAll()}
},45000);

test('manual terminal preserves Unicode command text, native split UTF-8 and stderr',async()=>{
 const terminals=new TerminalSessions(),quote=(s:string)=>"'"+s.replace(/'/g,process.platform==='win32'?"''":"'\\''")+"'";
 const text='中文输出🙂',bytes=[...Buffer.from(text)],code=`const b=Buffer.from([${bytes.join(',')}]);process.stdout.write(b.subarray(0,1));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write(Buffer.from([${[...Buffer.from('错误信息')].join(',')}]));},50)`;
 const native=`${process.platform==='win32'?'& ':''}${quote(process.execPath)} -e ${quote(code)}`;
 const command=process.platform==='win32'?`Write-Output '命令含中文';${native};[Console]::Error.WriteLine('标准错误中文')`:`printf '命令含中文\\n';${native};printf '标准错误中文\\n' >&2`;
 try{
  terminals.start('unicode',process.cwd(),command);
  await expect.poll(()=>terminals.read('unicode'),{timeout:30000}).toMatchObject({running:false,exitCode:0});
  const output=terminals.read('unicode').output;
  for(const expected of ['命令含中文',text,'错误信息','标准错误中文'])expect(output).toContain(expected);
  expect(output).not.toContain('\uFFFD');expect(output).not.toContain('CLIXML');expect(output).not.toContain('<Objs');
 }finally{terminals.closeAll()}
},45000);
