import {describe,it,expect,vi} from 'vitest';
import {JsonRecordStorage} from '../../../../../src/view/foundations/utility';
describe('JsonRecordStorage',()=>{
  const port=(raw:string|null=null)=>({getItem:vi.fn(()=>raw),setItem:vi.fn()});
  it('每次读端口，区分缺失、null 和坏 JSON，不删除坏记录',()=>{
    const storage=port(),records=new JsonRecordStorage(storage,'key',32);
    expect(records.read('limit')).toBeUndefined();
    storage.getItem.mockReturnValue('');expect(records.read('limit')).toBeUndefined();
    storage.getItem.mockReturnValue('null');expect(records.read('limit')).toBeNull();
    storage.getItem.mockReturnValue('{bad');expect(()=>records.read('limit')).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();expect(storage.getItem).toHaveBeenCalledTimes(4);
  });
  it('以 UTF-8 字节计量，恰好上限可写可读，超限不写',()=>{
    const storage=port('"中"'),records=new JsonRecordStorage(storage,'k',5);
    expect(records.read('read limit')).toBe('中');records.write('中','write limit');
    expect(storage.setItem).toHaveBeenCalledWith('k','"中"');
    storage.getItem.mockReturnValue('"中文"');expect(()=>records.read('read limit')).toThrow('read limit');
    expect(()=>records.write('中文','write limit')).toThrow('write limit');expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it('原样传播读写故障与序列化异常，实例键互不影响',()=>{
    const storage=port(),a=new JsonRecordStorage(storage,'a',100),b=new JsonRecordStorage(storage,'b',100);
    a.write({z:1,a:2},'limit');b.write({other:true},'limit');
    expect(storage.setItem.mock.calls).toEqual([['a','{"z":1,"a":2}'],['b','{"other":true}']]);
    const failure=Error('unavailable');storage.setItem.mockImplementation(()=>{throw failure});
    expect(()=>a.write({},'limit')).toThrow(failure);
    storage.getItem.mockImplementation(()=>{throw failure});expect(()=>a.read('limit')).toThrow(failure);
    expect(()=>a.write(1n,'limit')).toThrow();
  });
});
