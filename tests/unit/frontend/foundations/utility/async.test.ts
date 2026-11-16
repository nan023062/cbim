import {describe,expect,it} from 'vitest';
import {AsyncGeneration} from '../../../../../src/view/foundations/utility';

describe('AsyncGeneration',()=>{
  it('同一代次允许多次捕获，不因捕获而作废其他读取',()=>{
    const generation=new AsyncGeneration();
    const first=generation.Capture(),second=generation.Capture();
    expect(generation.IsCurrent(first)).toBe(true);
    expect(generation.IsCurrent(second)).toBe(true);
    expect(second).toBe(first);
  });

  it('推进后全部旧标记失效，返回新代次供新请求使用',()=>{
    const generation=new AsyncGeneration(),old=generation.Capture();
    const current=generation.Advance();
    expect(generation.IsCurrent(old)).toBe(false);
    expect(generation.IsCurrent(current)).toBe(true);
    expect(generation.Capture()).toBe(current);
    const next=generation.Advance();
    expect(generation.IsCurrent(old)).toBe(false);
    expect(generation.IsCurrent(current)).toBe(false);
    expect(generation.IsCurrent(next)).toBe(true);
  });

  it('实例独立且不接纳其他实例或外部创建的标记',()=>{
    const left=new AsyncGeneration(),right=new AsyncGeneration();
    const leftToken=left.Capture(),rightToken=right.Capture();
    expect(left.IsCurrent(rightToken)).toBe(false);
    expect(right.IsCurrent(leftToken)).toBe(false);
    expect(left.IsCurrent(Symbol())).toBe(false);
    left.Advance();
    expect(right.IsCurrent(rightToken)).toBe(true);
  });

  it('作废只影响结果资格，底层异步工作仍可完成',async()=>{
    const generation=new AsyncGeneration(),token=generation.Capture();
    let resolve!:(value:string)=>void;
    const work=new Promise<string>(done=>{resolve=done});
    generation.Advance();
    resolve('completed');
    expect(await work).toBe('completed');
    expect(generation.IsCurrent(token)).toBe(false);
  });
});
