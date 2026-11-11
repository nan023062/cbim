import {expect,it,vi} from 'vitest';
import type {Bridge} from '../src/bridge/contracts/workspace';

const electron=vi.hoisted(()=>({exposeInMainWorld:vi.fn(),invoke:vi.fn(),getPathForFile:vi.fn()}));
vi.mock('electron',()=>({contextBridge:{exposeInMainWorld:electron.exposeInMainWorld},ipcRenderer:{invoke:electron.invoke},webUtils:{getPathForFile:electron.getPathForFile}}));

it('预加载桥保持原通道与错误信封，不重试未知结果或把失败当空历史',async()=>{
  await import('../src/bridge/preload/preload');
  const [name,bridge]=electron.exposeInMainWorld.mock.calls[0] as [string,Bridge];
  expect(name).toBe('cbim');expect(Object.keys(bridge).sort()).toEqual(['call','importFiles']);
  electron.invoke.mockResolvedValueOnce({ok:true,value:{roles:[],diagnostics:['incomplete']}});
  expect(await bridge.call('agentHistory.roles',{workspaceId:'workspace'})).toEqual({roles:[],diagnostics:['incomplete']});
  expect(electron.invoke).toHaveBeenCalledWith('cbim:call','agentHistory.roles',{workspaceId:'workspace'});
  electron.invoke.mockResolvedValueOnce({ok:false,error:{code:'AGENT_HISTORY_UNREADABLE',message:'日志不可读'}});
  await expect(bridge.call('agentHistory.roles',{workspaceId:'workspace'})).rejects.toThrow('AGENT_HISTORY_UNREADABLE: 日志不可读');
  expect(electron.invoke).toHaveBeenCalledTimes(2);
});
