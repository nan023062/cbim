import {describe,it,expect} from 'vitest';
import {rankDirectedGraph,GraphTopologyError} from '../../../../../src/view/foundations/utility';
describe('frontend graph ranks',()=>{
  it('最长前驱分层、孤立节点及平行边保持确定结果',()=>{
    const ids=['a','b','c','d','alone'],edges:[string,string][]=[['a','b'],['a','c'],['b','c'],['c','d'],['c','d']];
    expect([...rankDirectedGraph(ids,edges)]).toEqual([['a',0],['b',1],['c',2],['d',3],['alone',0]]);
    expect(ids).toEqual(['a','b','c','d','alone']);expect(edges).toHaveLength(5);
    expect(rankDirectedGraph([],[]).size).toBe(0);
  });
  it.each([
    {ids:['a','a'],edges:[],code:'duplicate-node'},
    {ids:['a'],edges:[['a','b']],code:'missing-endpoint'},
    {ids:['a'],edges:[['a','a']],code:'cycle'},
    {ids:['a','b','isolated'],edges:[['a','b'],['b','a']],code:'cycle'},
  ])('报告 $code',({ids,edges,code})=>{
    let failure:unknown;try{rankDirectedGraph(ids,edges as [string,string][])}catch(error){failure=error}
    expect(failure).toBeInstanceOf(GraphTopologyError);expect(failure).toMatchObject({code});
  });
});
