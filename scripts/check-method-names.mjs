import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 只登记由外部调用方决定的方法名；文件、所属声明与方法名共同限制范围。
export const externalMethodNames = [
  { file: 'src/logic/updates/service/runtime-archive.ts', owner: 'new:Transform', name: 'transform', reason: 'Node Transform 构造选项约定，由流运行时调用。' },
  ...[
    ['src/framework/kernel/engines/adapter.ts', 'interface:EngineAdapter', ['create']],
    ['src/logic/execution/rules/engine-adapter.ts', 'interface:EngineAdapterOptions', ['requestBudget']],
    ['src/framework/kernel/engines/agent-engine.ts', 'interface:AgentEngine', ['start', 'run', 'steer', 'stop', 'close']],
    ['src/logic/execution/rules/types.ts', 'interface:EngineContext', ['assertMemberResume', 'emit', 'beforeTool']],
    ['src/logic/execution/rules/engine-tools.ts', 'interface:EngineToolsPort', ['list', 'call']],
    ['src/logic/projects/office-engine-loader.ts', 'interface:ChatTools', ['list', 'call']],
    ['src/logic/projects/office-engine-loader.ts', 'interface:OfficeEngineContext', ['beforeTool', 'emit']],
    ['src/logic/execution/rules/engine-runtime.ts', 'interface:EngineRuntimePackage', ['retain']],
    ['src/logic/budget/rules/request-budget.ts', 'interface:RequestBudgetPort', ['reserve']],
    ['src/logic/budget/rules/request-budget.ts', 'interface:RequestBudgetTicket', ['issue', 'assertSend', 'report', 'unknown', 'notSent']],
    ['src/engine-plugins/claude/engine.ts', 'class:ClaudeCodeEngine', ['start', 'run', 'stop', 'close']],
    ['src/engine-plugins/claude/engine.ts', 'interface:ClaudeOptions', ['requestBudget']],
    ['src/engine-plugins/codex/engine.ts', 'class:CodexEngine', ['start', 'run', 'stop', 'close']],
    ['src/engine-plugins/codex/engine.ts', 'interface:CodexOptions', ['requestBudget']],
    ['src/engine-plugins/memory/engine.ts', 'class:MemoryEngine', ['start', 'run', 'stop', 'close']],
    ['src/engine-plugins/pi/engine.ts', 'class:PiEngine', ['start', 'run', 'steer', 'stop', 'close']],
    ['src/engine-plugins/pi/engine.ts', 'interface:PiOptions', ['requestBudget']],
    ['src/engine-plugins/runtime-binding.ts', 'function:pinRuntimeEngine', ['start']],
  ].flatMap(([file, owner, names]) => names.map(name => ({ file, owner, name, reason: '已发布 EngineAdapter protocol=1 的包边界及其实现，必须与已安装包保持方法名兼容。' }))),
];

const slash = value => value.replaceAll('\\', '/');
const identity = value => JSON.stringify([slash(value.file), value.owner, value.name]);

function methodOwner(node, source)
{
  for (let parent = node.parent; parent; parent = parent.parent)
  {
    if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) return 'class:' + (parent.name?.getText(source) || '<anonymous>');
    if (ts.isInterfaceDeclaration(parent)) return 'interface:' + parent.name.text;
    if (ts.isTypeLiteralNode(parent) && ts.isPropertySignature(parent.parent)) return 'property:' + parent.parent.name.getText(source);
    if (ts.isObjectLiteralExpression(parent) && ts.isNewExpression(parent.parent)) return 'new:' + parent.parent.expression.getText(source);
    if (ts.isVariableDeclaration(parent)) return 'variable:' + parent.name.getText(source);
    if (ts.isTypeAliasDeclaration(parent)) return 'type:' + parent.name.text;
    if (ts.isFunctionDeclaration(parent)) return 'function:' + (parent.name?.text || '<anonymous>');
  }
  return '<anonymous>';
}

function methodName(node)
{
  if (!ts.isComputedPropertyName(node.name)) return { name: node.name.text };
  const expression = node.name.expression;
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return { name: expression.text };
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'Symbol') return { symbol: true };
  return { dynamic: true };
}

/** 只检查方法声明；字段、访问器、普通函数和保存函数值的变量遵循各自命名规则。 */
export function auditMethodNames(sources, exceptions = [])
{
  const allowed = new Map(), used = new Map(), violations = [], exempted = [];
  let methods = 0, symbolMethods = 0;
  for (const exception of exceptions)
  {
    const id = identity(exception);
    if (!exception.reason?.trim() || allowed.has(id)) throw Error('方法命名例外必须有唯一身份和原因');
    allowed.set(id, exception);
  }
  for (const { file, text } of sources)
  {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length)
    {
      violations.push({ file, line: 1, kind: 'syntax', name: '', owner: '', message: '源码语法错误，不能据此报告命名通过' });
      continue;
    }
    const visit = node => {
      if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node))
      {
        methods++;
        const result = methodName(node), line = source.getLineAndCharacterOfPosition(node.name.getStart(source)).line + 1;
        if (result.symbol) symbolMethods++;
        else
        {
          const item = { file: slash(file), owner: methodOwner(node, source), name: result.name || node.name.getText(source), line };
          const id = identity(item), exception = allowed.get(id);
          if (exception)
          {
            used.set(id, (used.get(id) || 0) + 1);
            exempted.push({ ...item, reason: exception.reason });
          }
          else if (result.dynamic || !/^#?[A-Z][A-Za-z0-9]*$/.test(item.name)) violations.push({ ...item, kind: result.dynamic ? 'dynamic-name' : 'naming', message: result.dynamic ? '动态方法名需明确契约，不能自动判定命名' : '方法名必须使用 PascalCase' });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const staleExceptions = [...allowed].filter(([id]) => !used.has(id)).map(([, value]) => value);
  const duplicateExceptions = [...used].filter(([, count]) => count > 1).map(([id, count]) => ({ ...allowed.get(id), count }));
  return { ok: violations.length === 0 && staleExceptions.length === 0 && duplicateExceptions.length === 0, files: sources.length, methods, symbolMethods, violations, exempted, staleExceptions, duplicateExceptions };
}

export function checkMethodNames(root = process.cwd())
{
  const sources = [];
  function visit(directory)
  {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
    {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'unittest') visit(file); }
      else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) sources.push({ file: slash(path.relative(root, file)), text: fs.readFileSync(file, 'utf8') });
    }
  }
  visit(path.join(root, 'src'));
  if (!sources.length) throw Error('没有找到源码，不能报告空检查通过');
  return auditMethodNames(sources, externalMethodNames);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
  const result = checkMethodNames();
  console.log(`方法命名：${result.files} 个文件，${result.methods} 处方法声明，${result.violations.length} 处违规，${result.exempted.length} 处已核实外部约定。`);
  if (!result.ok)
  {
    for (const item of result.violations) console.error(`${item.file}:${item.line} ${item.owner}.${item.name}：${item.message}`);
    for (const item of result.staleExceptions) console.error(`失效例外：${item.file} ${item.owner}.${item.name}`);
    for (const item of result.duplicateExceptions) console.error(`例外命中不唯一：${item.file} ${item.owner}.${item.name}`);
    process.exitCode = 1;
  }
}
