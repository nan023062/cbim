import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {planMemoryIndex,finishMemoryIndex,searchMemoryIndex} from '../../../../src/logic/knowledge/rules/memory-index';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const file=(path:string,text:string)=>({path,text,hash:hash(text)});
const snapshot={workspaceId:'workspace',instanceId:'instance',revision:'a'.repeat(64),files:[file('b','beta'),file('a','alpha')]};
test('完整来源与模型固定代际，命中保留来源引用且不更改原文',()=>{
  const plan=planMemoryIndex(snapshot,'b'.repeat(64),2),index=finishMemoryIndex(plan,[[1,0],[0,1]]);
  expect(searchMemoryIndex(index,[1,0],1)[0]).toMatchObject({path:'a',sourceHash:hash('alpha'),text:'alpha',offset:0,score:1});
  expect(planMemoryIndex({...snapshot,files:[...snapshot.files].reverse()},'b'.repeat(64),2).key).toBe(plan.key);
  expect(planMemoryIndex(snapshot,'c'.repeat(64),2).key).not.toBe(plan.key);
  expect(planMemoryIndex(snapshot,'b'.repeat(64),3).key).not.toBe(plan.key);
  expect(planMemoryIndex({...snapshot,revision:'d'.repeat(64)},'b'.repeat(64),2).key).not.toBe(plan.key);
});
test('失败新代不污染已完成索引，错误维度、零向量与未匹配正文拒绝',()=>{
  const plan=planMemoryIndex(snapshot,'b'.repeat(64),2),vectors=[[1,0],[0,1]],old=finishMemoryIndex(plan,vectors);vectors[0][0]=99;
  expect(old.vectors[0][0]).toBe(1);
  for(const bad of [[[1],[0,1]],[[0,0],[1,0]],[[NaN,1],[0,1]],[[1,0]]])expect(()=>finishMemoryIndex(plan,bad)).toThrow();
  expect(()=>searchMemoryIndex(old,[1])).toThrow();expect(()=>planMemoryIndex({...snapshot,files:[{...snapshot.files[0],text:'changed'}]},'b'.repeat(64),2)).toThrow('版本');
  expect(old.vectors).toEqual([[1,0],[0,1]]);
});
test('规模超限和重复来源不静默截断',()=>{
  expect(()=>planMemoryIndex({...snapshot,files:[file('large','x'.repeat(768*129))]},'b'.repeat(64),2)).toThrow('128');
  expect(()=>planMemoryIndex({...snapshot,files:[snapshot.files[0],snapshot.files[0]]},'b'.repeat(64),2)).toThrow('重复');
});
