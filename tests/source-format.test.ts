import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
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

test('独立语句和成员间空一行，Allman 大括号前后不重复留白', () => {
  expect(format('class Counter { private _count=0; Read(): number { this._count++; return this._count; } }')).toBe('class Counter\n{\n  private _count = 0;\n\n  Read(): number\n  {\n    this._count++;\n\n    return this._count;\n  }\n}\n');
});

test('相邻方法保留空行，空块、嵌套块与 else/catch/finally 内部不加空行', () => {
  const result = format('class A { First() {} Second() { try { if (true) { Run(); } else { Stop(); } } catch (error) { Fail(error); } finally { Done(); } } }');
  expect(result).toContain('First()\n  {\n  }\n\n  Second()');
  expect(result).toContain('if (true)\n        Run();\n      else\n        Stop();');
  expect(result).toContain('}\n    catch (error)\n    {');
  expect(result).toContain('}\n    finally\n    {');
  expect(result).not.toMatch(/\{\n\n|\n\n\s*\}/);
});

test('截图中的构造函数、Init 与私有方法之间始终空一行', () => {
  const result = format('class EnginePackages { constructor(private readonly file: string) {} Init() { return this.file; } private Save() { Persist(); } private Trusted() { return true; } }');
  expect(result).toContain('constructor(private readonly file: string)\n  {\n  }\n\n  Init()');
  expect(result).toContain('return this.file;\n  }\n\n  private Save()');
  expect(result).toContain('Persist();\n  }\n\n  private Trusted()');
});

test('方法、属性和字段的分隔空行位于下一成员注释之前', () => {
  const result = format('class Counter { Read() { return 1; }\n/** 当前值。 */\nget value() { return 1; }\n/** 设置值。 */\nset value(next: number) { Save(next); }\n/** 初始值。 */\nprivate _initial = 0; }');
  expect(result).toContain('}\n\n  /** 当前值。 */\n  get value()');
  expect(result).toContain('}\n\n  /** 设置值。 */\n  set value(next: number)');
  expect(result).toContain('}\n\n  /** 初始值。 */\n  private _initial = 0;\n}');
});

test('顶层、嵌套函数及后续独立语句均留分隔空行', () => {
  const result = format('function First() {}\n/** 第二个函数。 */\nfunction Second() { function Nested() {} function Other() {} if (ready) { Run(); } return 1; }\nclass A {}\ninterface Port { Read(): void; Save(): void; }');
  expect(result).toContain('}\n\n/** 第二个函数。 */\nfunction Second()');
  expect(result).toContain('Nested()\n  {\n  }\n\n  function Other()');
  expect(result).toContain('if (ready)\n    Run();\n\n  return 1;');
  expect(result).toContain('}\n\nclass A');
  expect(result).toContain('}\n\ninterface Port');
  expect(result).toContain('Read(): void;\n\n  Save(): void;');
});

test('对象方法也按成员分隔，单行箭头与签名内联类型仍遵守原有例外', () => {
  const result = format('const service = { First() {}, Second() {} };\nconst run = () => { function Nested() {} function Other() {} return { a: 1, b: 2 }; };\nfunction Read(value: { a: string; b: string; }): void {}');
  expect(result).toMatch(/First\(\)\n\s*\{\n\s*\},\n\n\s*Second\(\)/);
  expect(result).toContain('const run = () => { function Nested() { } function Other() { } return { a: 1, b: 2 }; };');
  expect(result).toContain('function Read(value: { a: string; b: string; }): void');
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

test('同一调用的参数连续分行对齐，参数之间和括号内侧均不空行', () => {
  expect(format('SaveDocument(\n\n documentId, content,\noptions, cancellationToken\n\n);')).toBe('SaveDocument(\n  documentId,\n  content,\n  options,\n  cancellationToken\n);\n');
});

test('调用参数分行不拆方法声明、导出声明及完整箭头，也不猜测数量阈值', () => {
  const text = 'function Save(a: string,\nb: string,\nc: string,\nd: string) {}\nSave(a, b, c, d);\nexport const result = Save(\na, b, c, d\n);\nconst run = () => Save(\na, b, c, d\n);';
  const result = format(text);
  expect(result).toContain('function Save(a: string, b: string, c: string, d: string)');
  expect(result).toContain('Save(a, b, c, d);');
  expect(result).toContain('export const result = Save(a, b, c, d);');
  expect(result).toContain('const run = () => Save(a, b, c, d);');
});

test('嵌套调用各自对齐，参数内部的逗号和箭头不误作外层参数', () => {
  const result = format('Outer(\nInner(\na,b\n), { first: 1, second: 2 }, (value: number) => value * 2\n);');
  expect(result).toBe('Outer(\n  Inner(\n    a,\n    b\n  ),\n  { first: 1, second: 2 },\n  (value: number) => value * 2\n);\n');
});

test('调用首参数说明紧贴括号，保留模板、行注释及参数求值顺序', () => {
  const text = 'Save(\n\n/** 第一个参数。 */\nRead(), // 先读\n`first\nsecond`, ...remaining\n\n);';
  const result = format(text);
  expect(result).toContain('Save(\n  /** 第一个参数。 */\n  Read(), // 先读');
  expect(result).toContain('`first\nsecond`');
  expect(result).toContain('...remaining\n);');
  expect(() => assertEquivalent('example.ts', text, result)).not.toThrow();
});

test('if 的单行执行体紧接条件，不用大括号；不同语句之间仍留空行', () => {
  expect(format('function Read(value: unknown) { if (!value)\n\nreturn false;\nreturn true; }')).toBe('function Read(value: unknown)\n{\n  if (!value)\n    return false;\n\n  return true;\n}\n');
  expect(format('if (ready) { Run(); } else { Stop(); }')).toBe('if (ready)\n  Run();\nelse\n  Stop();\n');
});

test('if 多条语句保留块，块内首尾不空行，后续独立语句另留空行', () => {
  expect(format('if (ready) { Validate(); Save(); } Next();')).toBe('if (ready)\n{\n  Validate();\n\n  Save();\n}\n\nNext();\n');
});

test('截图中的多行构造调用属于一条语句，参数连续排列且 if 包裹完整执行体', () => {
  const original = 'if (platform.engineArtifacts)\n\nthis.enginePackages = new EnginePackages(\n\npath.join(root, "engines.json"),\n\nplatform.engineArtifacts\n\n);\nthis.ready = true;';
  const result = format(original);
  expect(result).toBe('if (platform.engineArtifacts)\n{\n  this.enginePackages = new EnginePackages(\n    path.join(root, "engines.json"),\n    platform.engineArtifacts\n  );\n}\n\nthis.ready = true;\n');
  expect(() => assertEquivalent('example.ts', original, result, { allowIfBraces: true })).not.toThrow();
});

test('同一条声明、链式表达式、数组和对象内部不按物理行插空', () => {
  const result = format('const value = Create()\n\n.Next()\n\n.Done();\nconst items = [\n\nfirst,\n\nsecond\n\n];\nconst options = {\nfirst: 1,\n\nsecond: 2\n};');
  expect(result).toContain('Create()\n  .Next()\n  .Done();');
  expect(result).toContain('[\n  first,\n  second\n];');
  expect(result).toContain('{\n  first: 1,\n  second: 2\n};');
  expect(result).toContain('.Done();\n\nconst items');
});

test('受控 if 括号比较不能放过作用域变化、else 重绑定或无关 token 改写', () => {
  const allowed = { allowIfBraces: true };
  expect(() => assertEquivalent('example.ts', 'if (a) { Hit(); }', 'if (a) Hit();')).toThrow();
  expect(() => assertEquivalent('example.ts', 'if (a) { Hit(); }', 'if (a) Hit();', allowed)).not.toThrow();
  expect(() => assertEquivalent('example.ts', 'if (a) { if (b) Hit(); } else Miss();', 'if (a) if (b) Hit(); else Miss();', allowed)).toThrow(/语法树/);
  expect(() => assertEquivalent('example.ts', 'if (a) { let value = 1; }', 'if (a) let value = 1;', allowed)).toThrow();
  expect(() => assertEquivalent('example.ts', 'if (a) { Hit(); }', 'if (a) Miss();', allowed)).toThrow(/词法/);
  const result = formatSource('example.ts', 'let value = 1; if (ready) { let value = 2; }');
  expect(result.text).toContain('if (ready)\n{\n  let value = 2;\n}');
  expect(result.protectedRanges.some(item => item.reason === 'scope')).toBe(true);
});

test('ASI 所需括号不能删除，注释和模板原文不变', () => {
  const original = 'if (ready) { Run() }\n[1].forEach(Consume);\nif (ok) { /* 保留说明 */ Save(); }\nif (flag) Write(`first\nsecond`);';
  const result = formatSource('example.ts', original);
  expect(result.text).toContain('if (ready)\n{\n  Run()\n}');
  expect(result.protectedRanges.some(item => item.reason === 'if-syntax')).toBe(true);
  expect(result.text).toContain('/* 保留说明 */');
  expect(result.text).toContain('`first\nsecond`');
  expect(() => assertEquivalent('example.ts', original, result.text, { allowIfBraces: true })).not.toThrow();
  expect(formatSource('example.ts', result.text).text).toBe(result.text);
});

test('分支重排实际执行保持真假分支、循环跳转、异常和后续独立语句行为', () => {
  const samples = [
    'const events = []; if (outer) { events.push("yes"); } else { events.push("no"); } events.push("tail"); events;',
    'const events = []; if (outer)\nif (inner) events.push("inner"); else events.push("else"); events.push("tail"); events;',
    'const events = []; for (let i = 0; i < 4; i++) { if (i === 1) { continue; } if (i === 3) { break; } events.push(i); } events;',
    'const events = []; if (outer)\ntry { if (inner) { throw Error("failure"); } events.push("success"); } catch { events.push("caught"); } finally { events.push("finally"); } events.push("tail"); events;',
    'function Read(flag) { if (flag) return\n42; return 0; } [Read(outer), Read(inner)];',
  ];
  for (const text of samples)
  {
    const output = format(text, 'example.js');
    for (const outer of [false, true]) for (const inner of [false, true]) expect(JSON.stringify(runInNewContext(output, { outer, inner }))).toBe(JSON.stringify(runInNewContext(text, { outer, inner })));
  }
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
