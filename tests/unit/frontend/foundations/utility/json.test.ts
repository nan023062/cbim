import {expect,it} from 'vitest';
import {equalJson} from '../../../../../src/view/foundations/utility';

it('忽略嵌套对象键顺序，保持数组顺序及值类型',()=>{
  expect(equalJson({b:[{y:2,x:1}],a:true},{a:true,b:[{x:1,y:2}]})).toBe(true);
  expect(equalJson([1,2],[2,1])).toBe(false);
  expect(equalJson({value:1},{value:'1'})).toBe(false);
});

it('省略对象 undefined，保留 null 和数组位置',()=>{
  expect(equalJson({a:1,missing:undefined},{a:1})).toBe(true);
  expect(equalJson({missing:null},{})).toBe(false);
  expect(equalJson([undefined],[null])).toBe(true);
  expect(equalJson(Array(1),[null])).toBe(true);
  expect(equalJson([undefined],[])).toBe(false);
});

it('保持顶层不可序列化值及非有限数字的历史比较结果',()=>{
  expect(equalJson(undefined,undefined)).toBe(true);
  expect(equalJson(undefined,Symbol('value'))).toBe(true);
  expect(equalJson(undefined,null)).toBe(false);
  expect(equalJson(NaN,null)).toBe(true);
  expect(equalJson(Infinity,null)).toBe(true);
  expect(equalJson(-0,0)).toBe(true);
});

it('不修改冻结输入，也不改变调用方的键插入顺序',()=>{
  const nested=Object.freeze({z:1,a:2});
  const left=Object.freeze({b:Object.freeze([nested]),a:3});
  expect(equalJson(left,{a:3,b:[{a:2,z:1}]})).toBe(true);
  expect(Object.keys(left)).toEqual(['b','a']);
  expect(Object.keys(nested)).toEqual(['z','a']);
  expect(left.b[0]).toBe(nested);
});

it('保留自有危险名称键与整数键，不进行业务字段过滤',()=>{
  const left=JSON.parse('{"__proto__":{"marker":true},"constructor":1,"10":"x","2":"y"}');
  const right=JSON.parse('{"2":"y","10":"x","constructor":1,"__proto__":{"marker":true}}');
  expect(equalJson(left,right)).toBe(true);
  expect(equalJson(left,{'2':'y','10':'x',constructor:1})).toBe(false);
  expect(Object.getPrototypeOf(left)).toBe(Object.prototype);
});

it('localeCompare 同序 Unicode 键仍保持原插入次序，不暗改为字典序',()=>{
  expect('\u00e9'.localeCompare('e\u0301')).toBe(0);
  expect(equalJson({'\u00e9':1,'e\u0301':2},{'e\u0301':2,'\u00e9':1})).toBe(false);
});

it('循环和 BigInt 仍抛错，不把无法比较解释为不相等',()=>{
  const cycle:{self?:unknown}={};cycle.self=cycle;
  expect(()=>equalJson(cycle,{})).toThrow();
  expect(()=>equalJson({value:1n},{})).toThrow(TypeError);
});

it('属性读取失败原样传播',()=>{
  const failure=Error('read failed');
  const left=Object.defineProperty({},'value',{enumerable:true,get(){throw failure}});
  expect(()=>equalJson(left,{})).toThrow(failure);
});
