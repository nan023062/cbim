import { expect, test } from 'vitest';
import { auditMethodNames } from '../../scripts/check-method-names.mjs';

const source = (text: string, file = 'src/example.ts') => ({ file, text });

test('检查类、接口、类型和对象方法，保留字段、访问器及函数值的命名职责', () =>
{
  const result = auditMethodNames([source('class Example { private _value = 0; get value() { return this._value; } handler = () => 1; private read() {} static Write() {} } interface Port { run(): void; Done(): void; } type Other = { close(): void; }; const value = { stop() {} }; function helper() {}')]);
  expect(result.violations.map(item => item.name)).toEqual(['read', 'run', 'close', 'stop']);
  expect(result.methods).toBe(6);
});

test('接受大驼峰和运行时私有方法，拒绝下划线方法名', () =>
{
  const result = auditMethodNames([source('class Example { #LoadConfig() {} Save() {} _Reset() {} #read() {} }')]);
  expect(result.violations.map(item => item.name)).toEqual(['_Reset', '#read']);
});

test('检查字符串计算名；Symbol 协议不更名，未知动态名不能静默通过', () =>
{
  const result = auditMethodNames([source("const name = 'Read'; class Example { ['read']() {} ['Write']() {} [Symbol.iterator]() {} [name]() {} }")]);
  expect(result.symbolMethods).toBe(1);
  expect(result.violations.map(item => item.kind)).toEqual(['naming', 'dynamic-name']);
});

test('外部约定只豁免准确文件和所属声明，并报告理由', () =>
{
  const exception = { file: 'src/view.tsx', owner: 'class:Boundary', name: 'render', reason: '外部框架入口' };
  const result = auditMethodNames([source('class Boundary { render() {} } class Other { render() {} }', 'src/view.tsx')], [exception]);
  expect(result.exempted).toHaveLength(1);
  expect(result.violations.map(item => item.owner)).toEqual(['class:Other']);
  expect(result.exempted[0].reason).toBe(exception.reason);
});

test('失效或重复命中的例外会使检查失败', () =>
{
  const exception = { file: 'src/example.ts', owner: 'class:Boundary', name: 'render', reason: '外部框架入口' };
  const stale = auditMethodNames([source('class Boundary { Render() {} }')], [exception]);
  expect(stale.ok).toBe(false);
  expect(stale.staleExceptions).toHaveLength(1);
  const duplicate = auditMethodNames([source('class Boundary { render(): void; render() {} }')], [exception]);
  expect(duplicate.ok).toBe(false);
  expect(duplicate.duplicateExceptions).toHaveLength(1);
});

test('语法损坏、无理由例外与重复配置不能伪装通过', () =>
{
  expect(auditMethodNames([source('class Example { run(')]).ok).toBe(false);
  const exception = { file: 'src/example.ts', owner: 'class:Boundary', name: 'render', reason: '' };
  expect(() => auditMethodNames([], [exception])).toThrow();
  exception.reason = '框架约定';
  expect(() => auditMethodNames([], [exception, exception])).toThrow();
});
