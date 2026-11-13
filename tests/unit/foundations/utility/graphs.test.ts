import {describe,it,expect} from 'vitest';
import {isDirectedAcyclic} from '../../../../src/backend/core/foundation/utility';
describe('backend directed graph validation',()=>{
  it('空图、孤立节点、分支汇合与平行边无环',()=>{
    expect(isDirectedAcyclic([],[])).toBe(true);
    const nodes=['a','b','c','d','alone'],edges:[string,string][]=[['a','b'],['a','c'],['b','d'],['c','d'],['c','d']];
    expect(isDirectedAcyclic(nodes,edges)).toBe(true);expect(nodes).toHaveLength(5);expect(edges).toHaveLength(5);
  });
  it('自环、互等及孤立分量中的环均拒绝',()=>{
    expect(isDirectedAcyclic(['a'],[['a','a']])).toBe(false);
    expect(isDirectedAcyclic(['a','b'],[['a','b'],['b','a']])).toBe(false);
    expect(isDirectedAcyclic(['a','b','c','isolated'],[['a','b'],['b','c'],['c','a']])).toBe(false);
  });
  it('重复节点或缺端点不产生伪造的无环结论',()=>{
    expect(()=>isDirectedAcyclic(['a','a'],[])).toThrow('Duplicate');
    expect(()=>isDirectedAcyclic(['a'],[['a','missing']])).toThrow('Missing');
    expect(()=>isDirectedAcyclic(['a'],[['missing','a']])).toThrow('Missing');
  });
  it('长链无需递归调用栈，结果不依赖输入拓扑顺序',()=>{
    const nodes=Array.from({length:10000},(_,i)=>String(i));
    const edges=nodes.slice(1).map((id,i)=>[nodes[i],id] as const);
    expect(isDirectedAcyclic([...nodes].reverse(),edges)).toBe(true);
    expect(isDirectedAcyclic(nodes,[...edges,[nodes.at(-1)!,nodes[0]]])).toBe(false);
  });
});
