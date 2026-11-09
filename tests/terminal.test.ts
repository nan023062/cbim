import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {TerminalSessions} from '../src/backend/main/platform/terminal';
test('manual terminal captures output and exit status without sharing sessions',async()=>{
 const terminals=new TerminalSessions(),started=performance.now();let slowSnapshot:ReturnType<TerminalSessions['read']>|undefined,completionSnapshot:ReturnType<TerminalSessions['read']>|undefined;
 // 本项验证真实输出、退出码和会话隔离；Windows PowerShell 冷启动耗时不属于产品完成条件。
 // 保留十秒时的状态证据，使用与其他进程集成测试相当的有界等待，不重试命令。
 const slowTimer=setTimeout(()=>{slowSnapshot=terminals.read('one');console.log('TERMINAL_TEN_SECONDS',JSON.stringify(slowSnapshot))},10000);
 try{
 terminals.start('one',process.cwd(),process.platform==='win32'?"Write-Output 'TERMINAL_OK'":"printf TERMINAL_OK");
 await expect.poll(()=>terminals.read('one'),{timeout:30000}).toMatchObject({running:false,exitCode:0});
 completionSnapshot=terminals.read('one');
 expect(terminals.read('one')).toMatchObject({exitCode:0});expect(terminals.read('one').output).toContain('TERMINAL_OK');expect(terminals.read('other').output).toBe('');terminals.close('one');expect(terminals.read('one').output).toBe('');
 }finally{clearTimeout(slowTimer);const evidence={elapsedMs:performance.now()-started,slowSnapshot,completionSnapshot,finalSnapshot:terminals.read('one')};console.log('TERMINAL_COMPLETION',JSON.stringify(evidence));try{await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/terminal-state.json',JSON.stringify(evidence,null,2))}finally{terminals.closeAll()}}
},45000);
