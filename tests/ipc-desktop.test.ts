import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseIpcRequest,ipcSuccess} from '../src/bridge/contracts/ipc-call';

// 执行 main.ts 真正注册的回调；仅替换 Electron/系统副作用，不复制分派实现。
function desktop(){
  const file='src/bridge/server/main.ts',source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  let callback:ts.Expression|undefined;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='ipcMain.handle'&&node.arguments[0]?.getText(source)==="'cbim:call'")callback=node.arguments[1];ts.forEachChild(node,visit)};visit(source);
  if(!callback)throw Error('Missing actual desktop IPC registration');
  const webContents={mainFrame:{}},event={sender:webContents,senderFrame:webContents.mainFrame};
  const status={phase:'idle'},updates={status:vi.fn(()=>status),check:vi.fn(async()=>status),download:vi.fn(async()=>status),install:vi.fn(async()=>status)};
  const workspace={assert:vi.fn(),entry:{path:'workspace'}};
  const application={workspace:vi.fn(()=>workspace),dispatch:vi.fn(async()=>({known:true})),chatMaterials:{pick:vi.fn(async()=>[])}};
  const terminalValue={output:'hello',running:false,exitCode:0},terminals={start:vi.fn(()=>terminalValue),read:vi.fn(()=>terminalValue),close:vi.fn()};
  const dialog={showOpenDialog:vi.fn(async()=>({canceled:true,filePaths:[]}))},shell={openExternal:vi.fn(async()=>{}),openPath:vi.fn(async()=>'')};
  const text=ts.transpile('('+callback.getText(source)+')',{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
  const call=vm.runInNewContext(text,{window:{webContents},updates,application,terminals,dialog,shell,parseIpcRequest,ipcSuccess,URL,ChatInputs:class{}}) as (event:unknown,action:unknown,args?:unknown)=>Promise<{ok:boolean;value?:unknown;error?:{code?:string;message:string}}>;
  return {call:(action:unknown,args?:unknown)=>call(event,action,args),raw:call,event,status,updates,application,workspace,terminals,dialog,shell,terminalValue};
}
it('主 Frame 与安装期间门禁仍先于系统操作',async()=>{
  const f=desktop();await expect(f.raw({...f.event,senderFrame:{}},'terminal.start',{id:'w',tabId:'tab',command:'echo'})).rejects.toThrow('UNAUTHORIZED');
  expect(f.terminals.start).not.toHaveBeenCalled();
  f.status.phase='installing';expect(await f.call('chooseFolder')).toMatchObject({ok:false,error:{code:'UPDATING'}});expect(f.dialog.showOpenDialog).not.toHaveBeenCalled();
  expect(await f.call('desktop.updates.status')).toEqual({ok:true,value:f.status});
});
it('11 个原生操作使用对应请求和响应；关闭终端不要求重开工作区',async()=>{
  const f=desktop();
  for(const suffix of ['status','check','download','install'])expect(await f.call('desktop.updates.'+suffix)).toEqual({ok:true,value:f.status});
  for(const action of ['terminal.start','terminal.read'])expect(await f.call(action,{id:'w',tabId:'tab',...(action.endsWith('start')?{command:'echo'}:{})})).toEqual({ok:true,value:f.terminalValue});
  expect(f.terminals.start).toHaveBeenCalledWith('w:tab','workspace','echo');expect(f.workspace.assert).toHaveBeenCalledTimes(2);
  f.application.workspace.mockClear();expect(await f.call('terminal.close',{id:'w',tabId:'tab'})).toEqual({ok:true,value:undefined});expect(f.application.workspace).not.toHaveBeenCalled();
  expect(await f.call('github.feedback.openLogin')).toEqual({ok:true,value:true});expect(f.shell.openExternal).toHaveBeenLastCalledWith('https://github.com/login/device');
  expect(await f.call('chat.openLink',{id:'w',target:'https://example.com/item'})).toEqual({ok:true,value:true});
  expect(await f.call('chat.pick',{id:'w',kind:'file'})).toEqual({ok:true,value:[]});expect(await f.call('chooseFolder')).toEqual({ok:true,value:null});
});
it('畸形请求不触发终端、文件选择或链接操作，错误与业务异常保持信封',async()=>{
  const f=desktop();
  for(const [action,args] of [['terminal.start',{id:'w',tabId:'../bad',command:'echo'}],['chat.pick',{id:'w',kind:'secret'}],['chat.openLink',{id:'w',target:17}],['chooseFolder',{path:'injected'}]] as const)expect(await f.call(action,args)).toMatchObject({ok:false});
  expect(f.terminals.start).not.toHaveBeenCalled();expect(f.dialog.showOpenDialog).not.toHaveBeenCalled();expect(f.shell.openExternal).not.toHaveBeenCalled();expect(f.application.workspace).not.toHaveBeenCalled();
  expect(await f.call(null)).toMatchObject({ok:false,error:{code:'ACTION'}});
  f.application.dispatch.mockRejectedValueOnce(Object.assign(Error('unknown result'),{code:'GOVERNANCE_APPLY_UNKNOWN'}));
  expect(await f.call('governance.apply',{})).toEqual({ok:false,error:{code:'GOVERNANCE_APPLY_UNKNOWN',message:'unknown result'}});expect(f.application.dispatch).toHaveBeenCalledTimes(1);
});
