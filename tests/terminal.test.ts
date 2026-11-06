import {test,expect} from 'vitest';
import {TerminalSessions} from '../src/backend/main/platform/terminal';
test('manual terminal captures output and exit status without sharing sessions',async()=>{
 const terminals=new TerminalSessions();try{
 terminals.start('one',process.cwd(),process.platform==='win32'?"Write-Output 'TERMINAL_OK'":"printf TERMINAL_OK");
 await expect.poll(()=>terminals.read('one').running,{timeout:10000}).toBe(false);
 expect(terminals.read('one')).toMatchObject({exitCode:0});expect(terminals.read('one').output).toContain('TERMINAL_OK');expect(terminals.read('other').output).toBe('');terminals.close('one');expect(terminals.read('one').output).toBe('');
 }finally{terminals.closeAll()}
});
