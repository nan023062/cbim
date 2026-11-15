import {test,expect,vi} from 'vitest';
import {settingsIpcRequests} from '../src/bridge/contracts/ipc-settings';
import {settingsIpcHandlers} from '../src/bridge/server/ipc/settings-handlers';
import type {ApplicationServices} from '../src/bridge/server/ipc/services';

test('引擎设置 IPC 只接受官方 ID、准确版本摘要和 revision，不接受路径或任意源',async()=>{
  const input={kind:'pi',revision:1,identity:'a'.repeat(64)};
  expect(settingsIpcRequests['engines.install'].parse(input)).toEqual(input);
  for(const value of [{...input,path:'C:/outside'},{...input,url:'https://other.example'},{...input,kind:'user-plugin'},{...input,revision:-1}])expect(settingsIpcRequests['engines.install'].safeParse(value).success).toBe(false);
  const view={managed:true,revision:2,items:[]},manager={read:vi.fn(async()=>view),install:vi.fn(async()=>{}),check:vi.fn(async()=>{}),setEnabled:vi.fn(async()=>{})};
  const handlers=settingsIpcHandlers({enginePackages:manager} as unknown as ApplicationServices);
  expect(await handlers['engines.install'](input as never)).toEqual(view);expect(manager.install).toHaveBeenCalledWith('pi',{revision:1,identity:input.identity});
  await handlers['engines.configure']({kind:'codex',revision:2,action:'remove'});expect(manager.setEnabled).toHaveBeenCalledWith('codex',false,true,2);
});
test('开发模式明确显示不管理正式包，不伪造安装成功',async()=>{
  const handlers=settingsIpcHandlers({} as ApplicationServices);
  expect(await handlers['engines.settings'](undefined)).toEqual({managed:false,revision:0,items:[]});
  await expect(handlers['engines.install']({kind:'pi',revision:0,identity:'a'.repeat(64)})).rejects.toThrow(/开发模式/);
});
