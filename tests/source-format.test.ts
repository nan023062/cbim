import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { assertEquivalent, formatSource, formatSources } from '../scripts/source-format.mjs';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function format(text: string, file = 'example.ts'): string
{
  const first = formatSource(file, text).text;
  expect(formatSource(file, first).text).toBe(first);
  return first;
}

function workspace(files: Record<string, string>): string
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cbim-source-format-'));
  temporary.push(directory);
  fs.mkdirSync(path.join(directory, 'src'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(directory, 'src', name), text);
  return directory;
}

test('普通代码行间空一行，Allman 大括号前后不重复留白', () => {
  expect(format('class Counter { private _count=0; Read(): number { this._count++; return this._count; } }')).toBe('class Counter\n{\n  private _count = 0;\n\n  Read(): number\n  {\n    this._count++;\n\n    return this._count;\n  }\n}\n');
});

test('空块、相邻方法、嵌套块与 else/catch/finally 的大括号承担间距', () => {
  const result = format('class A { First() {} Second() { try { if (true) { Run(); } else { Stop(); } } catch (error) { Fail(error); } finally { Done(); } } }');
  expect(result).toContain('First()\n  {\n  }\n  Second()');
  expect(result).toContain('}\n      else\n      {');
  expect(result).toContain('}\n    catch (error)\n    {');
  expect(result).toContain('}\n    finally\n    {');
  expect(result).not.toMatch(/\{\n\n|\n\n\s*\}/);
});

test('导入、重导出和导出表达式保持单行且相互留白', () => {
  const result = format("import {\n a,\n b\n} from 'a';\nimport type {\nC\n} from 'c';\nexport {\na, b\n};\nexport const schema = z\n.string()\n.optional();");
  expect(result).toContain("import { a, b } from 'a';\n\nimport type { C } from 'c';\n\nexport { a, b };\n\nexport const schema = z.string().optional();");
});

test('方法与接口签名保持一行，包括参数和返回值的内联类型', () => {
  const result = format('interface Port { Read(\n options: {\n value: string;\n }\n): {\n result: number;\n}; } class Service { async Read(\n value: string\n): Promise<string> { return value; } }');
  expect(result).toContain('Read(options: { value: string; }): { result: number; };');
  expect(result).toContain('async Read(value: string): Promise<string>\n');
});

test('箭头函数整体单行，内部多语句与块不套用 Allman 或逐行留白', () => {
  const result = format('const run = (\nvalue: number\n): number =>\n{\nconst doubled = value * 2;\nreturn doubled;\n};\nconst stop = () =>\n{\n};');
  expect(result).toBe('const run = (value: number): number => { const doubled = value * 2; return doubled; };\n\nconst stop = () => { };\n');
});

test('导出中的普通函数正文仍展开，箭头正文仍单行', () => {
  const result = format('export const handlers = { Read() { const x = 1; return x; }, other: () => { return 2; } };');
  expect(result).toContain('Read()\n');
  expect(result).toContain('const x = 1;\n\n');
  expect(result).toContain('other: () => { return 2; }');
});

test('说明紧贴成员，保留行末注释及编译指令的行边界', () => {
  const text = 'class A {\n/** 成员说明。 */\nprivate _x = 1; // 单位：次\n/** 读取当前值。 */\nRead() {\n// @ts-expect-error 有意验证外部错误\nMissing();\nreturn this._x;\n}\n}';
  const result = format(text);
  expect(result).toContain('/** 成员说明。 */\n  private _x = 1; // 单位：次');
  expect(result).toContain('// 单位：次\n\n  /** 读取当前值。 */');
  expect(result).toContain('// @ts-expect-error 有意验证外部错误\n    Missing();');
  expect(result).toContain('/** 读取当前值。 */\n  Read()');
});

test('必要的注释、模板与 JSX 换行被保留并报告原因，不豁免整个文件', () => {
  const text = 'const first = 1;\nconst second = 2;\nconst template = () => `first\n  second`;\nconst comment = () => {\n// 保留这条注释\nreturn 1;\n};\nconst View = () => (<div>first\n  second <b>bold</b></div>);';
  const result = formatSource('example.tsx', text);
  expect(result.text).toContain('const first = 1;\n\nconst second = 2;');
  expect(result.text).toContain('`first\n  second`');
  expect(result.text).toContain('>first\n  second <');
  expect(result.protectedRanges.map(item => item.reason)).toEqual(expect.arrayContaining(['literal', 'comment', 'jsx-text']));
  expect(formatSource('example.tsx', result.text).text).toBe(result.text);
});

test('正则、模板插值、对象返回和 JSX 空白的原始文本不变', () => {
  const text = 'const regex = /https?:\\/\\/[^/]+/g;\nconst message = `prefix ${value} suffix`;\nfunction read() { return { value: regex }; }\nconst element = <div> a <b>{message}</b> b </div>;';
  const result = format(text, 'example.tsx');
  expect(() => assertEquivalent('example.tsx', text, result)).not.toThrow();
  expect(result).toContain('return { value: regex };');
  expect(result).toContain('> a <');
  expect(result).toContain('> b </');
});

test('语义校验拦截 ASI、字面量、注释和 JSX 内容变化', () => {
  expect(() => assertEquivalent('example.ts', 'function Read() { return\n42; }', 'function Read() { return 42; }')).toThrow(/语法树/);
  expect(() => assertEquivalent('example.ts', 'const x = `a\nb`;', 'const x = `a b`;')).toThrow(/词法/);
  expect(() => assertEquivalent('example.ts', '// 说明\nRun();', '// 更改\nRun();')).toThrow(/词法/);
  expect(() => assertEquivalent('example.tsx', 'const x = <b> a </b>;', 'const x = <b>a</b>;')).toThrow(/词法/);
});

test('嵌套 JSX 的边界不插入新的文本节点或扩展原文本', () => {
  const text = 'function View() { return <>\n  {items.map(item => <p>{item.name} · {item.description}</p>)}\n  <div><b/><i/></div>\n</>; }';
  const result = format(text, 'example.tsx');
  expect(() => assertEquivalent('example.tsx', text, result)).not.toThrow();
  expect(result).toContain('} · {');
  expect(result).toContain('<b /><i />');
});

test('无法仅靠空白合并的无分号箭头拒绝写入，避免 ASI 改变含义', () => {
  expect(() => formatSource('example.ts', 'const run = () => {\nreturn\n42\n};')).toThrow(/语法树|语法错误/);
});

test('CRLF、shebang 和许可证保持，单行 for 头不拆成连续语句', () => {
  const text = '#!/usr/bin/env node\r\n/* License */\r\nfor (let i=0; i<3; i++) { Run(i); }\r\n';
  const result = format(text);
  expect(result).toMatch(/^#!\/usr\/bin\/env node\r\n\/\* License \*\//);
  expect(result).toContain('for (let i = 0; i < 3; i++)\r\n{\r\n  Run(i);\r\n}');
  expect(result.replaceAll('\r\n', '')).not.toContain('\n');
});

test('检查模式只读，写入后零漂移；批次失败不能留下部分重排', () => {
  const root = workspace({ 'a.ts': 'const a=1;\nconst b=2;' });
  expect(formatSources(root).changed).toEqual(['src/a.ts']);
  expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('const a=1;\nconst b=2;');
  expect(formatSources(root, true).changed).toHaveLength(1);
  expect(formatSources(root).changed).toEqual([]);
  const invalid = workspace({ 'a.ts': 'const a=1;', 'z.ts': 'class Broken {' });
  expect(() => formatSources(invalid, true)).toThrow(/语法/);
  expect(fs.readFileSync(path.join(invalid, 'src/a.ts'), 'utf8')).toBe('const a=1;');
});

test('正文后的静态导入不擅自迁移，空目录和无效源码不能通过', () => {
  expect(() => formatSource('example.ts', "Run(); import { value } from './module';")).toThrow(/加载顺序/);
  expect(() => formatSources(workspace({}))).toThrow(/没有/);
  expect(() => formatSource('example.ts', 'function Broken(')).toThrow(/语法/);
});

test('命令行检查失败退出且不写盘，修正后通过，并提供可定位的 JSON 结果', () => {
  const root = workspace({ 'example.ts': 'const a=1;\nconst b=2;' });
  const command = path.resolve('scripts/source-format.mjs');
  const run = (...args: string[]) => spawnSync(process.execPath, [command, ...args], { cwd: root, encoding: 'utf8' });
  const before = run('--check', '--json');
  expect(before.status).toBe(1);
  expect(JSON.parse(before.stdout).violations).toEqual([{ file: 'src/example.ts', line: 1 }]);
  expect(fs.readFileSync(path.join(root, 'src/example.ts'), 'utf8')).toBe('const a=1;\nconst b=2;');
  expect(run('--write').status).toBe(0);
  const after = run('--check', '--json');
  expect(after.status).toBe(0);
  expect(JSON.parse(after.stdout).changed).toEqual([]);
  expect(run('--write', '--check').status).toBe(1);
});
