import {describe,expect,it} from 'vitest';
import {AsyncGeneration} from '../../../../../src/frontend/foundations/utility';

describe('AsyncGeneration',()=>{
  it('同一代次允许多次捕获，不因捕获而作废其他读取',()=>{
    const generation=new AsyncGeneration();
    const first=generation.capture(),second=generation.capture();
    expect(generation.isCurrent(first)).toBe(true);
    expect(generation.isCurrent(second)).toBe(true);
    expect(second).toBe(first);
  });

  it('推进后全部旧标记失效，返回新代次供新请求使用',()=>{
    const generation=new AsyncGeneration(),old=generation.capture();
    const current=generation.advance();
    expect(generation.isCurrent(old)).toBe(false);
    expect(generation.isCurrent(current)).toBe(true);
    expect(generation.capture()).toBe(current);
    const next=generation.advance();
    expect(generation.isCurrent(old)).toBe(false);
    expect(generation.isCurrent(current)).toBe(false);
    expect(generation.isCurrent(next)).toBe(true);
  });

  it('实例独立且不接纳其他实例或外部创建的标记',()=>{
    const left=new AsyncGeneration(),right=new AsyncGeneration();
    const leftToken=left.capture(),rightToken=right.capture();
    expect(left.isCurrent(rightToken)).toBe(false);
    expect(right.isCurrent(leftToken)).toBe(false);
    expect(left.isCurrent(Symbol())).toBe(false);
    left.advance();
    expect(right.isCurrent(rightToken)).toBe(true);
  });

  it('作废只影响结果资格，底层异步工作仍可完成',async()=>{
    const generation=new AsyncGeneration(),token=generation.capture();
    let resolve!:(value:string)=>void;
    const work=new Promise<string>(done=>{resolve=done});
    generation.advance();
    resolve('completed');
    expect(await work).toBe('completed');
    expect(generation.isCurrent(token)).toBe(false);
  });
});
