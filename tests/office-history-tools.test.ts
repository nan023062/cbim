import {expect,it,vi} from 'vitest';
import {OfficeHistoryTools} from '../src/logic/tools/runtime/office-history-tools';

const identity={workspaceId:'workspace',rootSessionId:'root'};
it('主归档工具只读且身份绑定，输入不能指定另一个办公室或路径',async()=>{
 const read=vi.fn(async()=>({...identity,action:'topics',version:'a'.repeat(64),offset:0,items:[]})),tools=new OfficeHistoryTools(identity,read);
 expect(tools.list()[0]).toMatchObject({name:'cbim_office_history',effects:['read']});expect(tools.describe('cbim_office_history',{action:'topics'})).toEqual({effects:['read'],native:false});
 const signal=new AbortController().signal;await tools.call('cbim_office_history',{action:'topics'},signal);expect(read).toHaveBeenCalledWith({action:'topics',offset:0,limit:20},signal);
 await expect(tools.call('cbim_office_history',{action:'topics',rootSessionId:'foreign'},signal)).rejects.toBeDefined();expect(read).toHaveBeenCalledTimes(1);
 read.mockResolvedValue({...identity,rootSessionId:'foreign',action:'topics',version:'a'.repeat(64),offset:0,items:[]});await expect(tools.call('cbim_office_history',{action:'topics'},signal)).rejects.toBeDefined();
});
it('取消不进入日志读取；内容回包必须对应原话题及引用',async()=>{
 const read=vi.fn(async()=>({...identity,action:'content',scopeId:'other',refId:'goal',version:'a'.repeat(64),offset:0,totalChars:1,text:'x'})),tools=new OfficeHistoryTools(identity,read),stop=new AbortController();stop.abort();
 await expect(tools.call('cbim_office_history',{action:'topics'},stop.signal)).rejects.toBeDefined();expect(read).not.toHaveBeenCalled();
 await expect(tools.call('cbim_office_history',{action:'content',scopeId:'original',refId:'goal'},new AbortController().signal)).rejects.toBeDefined();
});
