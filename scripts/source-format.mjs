import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 排版只改词法间隙；if 的作用域中性包裹块另行规范化并验证，其他 token 与注释不可改写。
function parse(file, text)
{
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw Error(`${file}: 源码存在语法错误，停止排版`);
  return source;
}

function lexemes(source)
{
  const tokens = [];
  const visit = node => {
    if (ts.isJSDoc(node)) return;
    if (node.kind <= ts.SyntaxKind.LastToken)
    {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken)
      {
        const start = node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(source);
        tokens.push({ start, end: node.end, kind: node.kind, text: source.text.slice(start, node.end) });
      }
      return;
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  const result = [];
  let cursor = 0;
  const trivia = end => {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.text.slice(cursor, end));
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    {
      if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) continue;
      if (![ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia, ts.SyntaxKind.ShebangTrivia].includes(kind)) throw Error(`${source.fileName}: 无法识别的词法间隙 ${cursor + scanner.getTokenPos()}`);
      result.push({ start: cursor + scanner.getTokenPos(), end: cursor + scanner.getTextPos(), kind, text: scanner.getTokenText(), comment: true });
    }
  };
  for (const token of tokens)
  {
    if (token.start < cursor) throw Error(`${source.fileName}: 词法单元重叠`);
    trivia(token.start);
    result.push(token);
    cursor = token.end;
  }
  trivia(source.text.length);
  return result;
}

function scopeNeutralStatement(node)
{
  if (simpleBranch(node) || ts.isEmptyStatement(node)) return true;
  if (!(ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node) || ts.isLabeledStatement(node))) return false;
  let functionDeclaration = false;
  const visit = child => {
    if (ts.isFunctionDeclaration(child)) functionDeclaration = true;
    else if (!ts.isFunctionExpression(child) && !ts.isArrowFunction(child)) ts.forEachChild(child, visit);
  };
  visit(node);
  return !functionDeclaration;
}

function simpleBranch(node)
{
  return ts.isExpressionStatement(node) || ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isBreakStatement(node) || ts.isContinueStatement(node);
}

function transparentIfBlock(node)
{
  return ts.isBlock(node) && ts.isIfStatement(node.parent) && (node.parent.thenStatement === node || node.parent.elseStatement === node) && node.statements.length === 1 && scopeNeutralStatement(node.statements[0]);
}

function shape(node, allowIfBraces = false)
{
  if (allowIfBraces && transparentIfBlock(node)) return shape(node.statements[0], true);
  const children = [];
  ts.forEachChild(node, child => { children.push(shape(child, allowIfBraces)); });
  return [node.kind, ts.isVariableDeclarationList(node) ? node.flags : null, node.operator ?? null, children];
}

/** 默认严格比较；明确允许 if 包裹块时，仍保留作用域声明、分支归属及其他 token 的完整比较。 */
export function assertEquivalent(file, before, after, options = {})
{
  const left = parse(file, before), right = parse(file, after);
  const fingerprint = source => {
    const omitted = new Set();
    const visit = node => {
      if (options.allowIfBraces && transparentIfBlock(node)) for (const child of node.getChildren(source)) if (child.kind === ts.SyntaxKind.OpenBraceToken || child.kind === ts.SyntaxKind.CloseBraceToken) omitted.add(child.getStart(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    return lexemes(source).filter(item => !omitted.has(item.start)).map(item => [item.kind, item.text]);
  };
  const leftTokens = fingerprint(left), rightTokens = fingerprint(right);
  if (JSON.stringify(leftTokens) !== JSON.stringify(rightTokens))
  {
    const index = leftTokens.findIndex((token, position) => JSON.stringify(token) !== JSON.stringify(rightTokens[position]));
    throw Error(`${file}: 词法单元、注释或字面量发生变化，token ${index}: ${JSON.stringify(leftTokens[index])?.slice(0, 100)} → ${JSON.stringify(rightTokens[index])?.slice(0, 100)}`);
  }
  if (JSON.stringify(shape(left, options.allowIfBraces)) !== JSON.stringify(shape(right, options.allowIfBraces))) throw Error(`${file}: 语法树发生变化，可能涉及自动分号插入、作用域或 else 归属`);
}

function isBraceContainer(node)
{
  return ts.isBlock(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node) || ts.isEnumDeclaration(node);
}

function isSignature(node)
{
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isCallSignatureDeclaration(node) || ts.isConstructSignatureDeclaration(node) || ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node);
}

function layout(source)
{
  const text = source.text, entries = lexemes(source), breaks = new Map(), groups = [], protectedRanges = [], separators = new Set();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const entryAt = new Map(entries.map((entry, index) => [entry.start, index]));
  const mark = (position, priority = 3) => breaks.set(position, Math.max(priority, breaks.get(position) ?? 0));
  const before = (node, priority = 3) => {
    const comments = ts.getLeadingCommentRanges(text, node.pos) ?? [];
    const position = comments[0]?.pos ?? node.getStart(source);
    mark(position, priority);
    if (comments.length) mark(node.getStart(source), priority);
    return position;
  };
  const single = (node, end = node.end, priority = 5, rule = 'single-line') => {
    const start = node.getStart(source);
    const inside = entries.filter(entry => entry.start >= start && entry.end <= end);
    const protectedEntry = inside.find(entry => /[\r\n]/.test(entry.text) || entry.kind === ts.SyntaxKind.SingleLineCommentTrivia || entry.kind === ts.SyntaxKind.ShebangTrivia);
    if (protectedEntry)
    {
      if (/[\r\n]/.test(text.slice(start, end))) protectedRanges.push({ line: source.getLineAndCharacterOfPosition(start).line + 1, rule, reason: protectedEntry.comment ? 'comment' : protectedEntry.kind === ts.SyntaxKind.JsxText ? 'jsx-text' : 'literal' });
      return;
    }
    groups.push({ start, end, priority });
  };
  const members = nodes => {
    for (let index = 0; index < nodes.length; index++)
    {
      const position = before(nodes[index]);
      // 成员间距属于声明边界；前一个成员的右大括号不能抵消它。
      // 首成员不加空行，说明注释与声明之间也不加空行。
      if (index > 0) separators.add(position);
    }
  };
  let sawBody = false;
  for (const statement of source.statements)
  {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement))
    {
      if (sawBody) throw Error(`${source.fileName}: 静态 import 必须集中在正文之前，请核对加载顺序后移动`);
    }
    else sawBody = true;
  }
  const visit = node => {
    // 换行由维护者按阅读需要选择；只规整已有分行的实参，不猜测数量阈值。
    // 调用布局优先级低于必须单行的导出、声明头及箭头函数。
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments?.length > 1)
    {
      const children = node.getChildren(source);
      const open = children.find(child => child.kind === ts.SyntaxKind.OpenParenToken);
      const close = children.findLast(child => child.kind === ts.SyntaxKind.CloseParenToken);
      const multiline = open && close && (node.arguments.some((argument, index) => /[\r\n]/.test(text.slice(index ? node.arguments[index - 1].end : open.end, argument.getStart(source)))) || /[\r\n]/.test(text.slice(node.arguments.at(-1).end, close.getStart(source))));
      if (multiline)
      {
        for (const argument of node.arguments) before(argument, 0.5);
        mark(close.getStart(source), 0.5);
      }
    }
    if (isBraceContainer(node))
    {
      const children = node.getChildren(source);
      const open = children.find(child => child.kind === ts.SyntaxKind.OpenBraceToken);
      const close = children.find(child => child.kind === ts.SyntaxKind.CloseBraceToken);
      if (open && close)
      {
        mark(open.getStart(source));
        mark(close.getStart(source));
        const following = entries[entryAt.get(open.getStart(source)) + 1];
        if (following) mark(following.start);
      }
      if (node.members) members(node.members);
    }
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property))) members(node.properties);
    if (node.statements) for (let index = 0; index < node.statements.length; index++)
    {
      const position = before(node.statements[index]);
      if (index > 0) separators.add(position);
    }
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) single(node, node.end, 5, 'import-export');
    if (ts.isExportAssignment(node) || ((ts.isVariableStatement(node) || ts.isTypeAliasDeclaration(node)) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) single(node, node.end, 1, 'export-expression');
    if (isSignature(node)) single(node, node.body?.getStart(source) ?? node.end, 4, 'signature');
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node))
    {
      const open = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.OpenBraceToken);
      if (open) single(node, open.getStart(source), 4, 'declaration-head');
    }
    if (ts.isArrowFunction(node)) single(node, node.end, 5, 'arrow');
    if (ts.isIfStatement(node))
    {
      before(node.thenStatement);
      if (node.elseStatement)
      {
        const keyword = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.ElseKeyword);
        if (keyword) mark(keyword.getStart(source));
        if (!ts.isIfStatement(node.elseStatement)) before(node.elseStatement);
      }
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isWithStatement(node) || ts.isLabeledStatement(node)) before(node.statement);
    if (ts.isVariableDeclarationList(node) && node.declarations.length > 1 && !ts.isForStatement(node.parent)) for (const declaration of node.declarations.slice(1)) before(declaration);
    if (ts.isTryStatement(node)) for (const child of node.getChildren(source)) if (child.kind === ts.SyntaxKind.FinallyKeyword) mark(child.getStart(source));
    if (ts.isCatchClause(node)) mark(node.getStart(source));
    if (ts.isDoStatement(node)) for (const child of node.getChildren(source)) if (child.kind === ts.SyntaxKind.WhileKeyword) mark(child.getStart(source));
    ts.forEachChild(node, visit);
  };
  visit(source);

  let output = '';
  for (let index = 0; index < entries.length; index++)
  {
    const current = entries[index], previous = entries[index - 1];
    const start = previous?.end ?? 0, original = text.slice(start, current.start);
    if (!previous)
    {
      output += original.replace(/[^\S\uFEFF]+/g, '') + current.text;
      continue;
    }
    const priority = Math.max(0, ...groups.filter(group => start > group.start && current.start < group.end).map(group => group.priority));
    const forced = breaks.get(current.start) ?? 0;
    const lineComment = previous.kind === ts.SyntaxKind.SingleLineCommentTrivia || previous.kind === ts.SyntaxKind.ShebangTrivia;
    if (priority > forced && !lineComment)
    {
      output += (original.length ? ' ' : '') + current.text;
      continue;
    }
    if (!forced && !/[\r\n]/.test(original) && !lineComment)
    {
      output += original + current.text;
      continue;
    }
    // 空行只分隔独立语句或成员；同一语句的条件、实参、链式表达式和括号连续排版。
    const count = separators.has(current.start) ? 2 : 1;
    const indent = /(?:\r?\n)([ \t]*)$/.exec(original)?.[1] ?? '';
    output += eol.repeat(count) + indent + current.text;
  }
  return { text: output + eol, protectedRanges };
}

function indent(source)
{
  const entries = lexemes(source);
  const options = { indentSize: 2, tabSize: 2, newLineCharacter: source.text.includes('\r\n') ? '\r\n' : '\n', convertTabsToSpaces: true, placeOpenBraceOnNewLineForFunctions: true, placeOpenBraceOnNewLineForControlBlocks: true, insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true, insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true, insertSpaceAfterFunctionKeywordForAnonymousFunctions: true };
  const edits = ts.formatting.formatDocument(source, ts.formatting.getFormatContext(options));
  let text = source.text;
  for (const edit of edits.sort((a, b) => b.span.start - a.span.start))
  {
    const start = edit.span.start, end = start + edit.span.length;
    if (!/^\s*$/.test(text.slice(start, end)) || !/^\s*$/.test(edit.newText)) throw Error(`${source.fileName}: 缩进工具试图改写非空白内容`);
    if (entries.some(entry => start < entry.end && end > entry.start || start === end && start > entry.start && start < entry.end)) continue;
    if (entries.some(entry => entry.kind === ts.SyntaxKind.JsxText && start <= entry.end && end >= entry.start)) continue;
    text = text.slice(0, start) + edit.newText + text.slice(end);
  }
  return text;
}

function ifBodies(source)
{
  const text = source.text, edits = [], protectedRanges = [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const retain = (node, reason) => protectedRanges.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule: 'if-braces', reason });
  const visit = node => {
    if (ts.isIfStatement(node)) for (const body of [node.thenStatement, node.elseStatement].filter(Boolean))
    {
      // else if 是同一条件链，不额外套块或改变 else 的绑定。
      if (body === node.elseStatement && ts.isIfStatement(body)) continue;
      if (ts.isBlock(body))
      {
        if (body.statements.length !== 1) continue;
        const statement = body.statements[0];
        if (/[\r\n]/.test(statement.getText(source))) continue;
        if (!simpleBranch(statement))
        {
          retain(body, scopeNeutralStatement(statement) ? 'control-flow' : 'scope');
          continue;
        }
        const braces = body.getChildren(source).filter(child => child.kind === ts.SyntaxKind.OpenBraceToken || child.kind === ts.SyntaxKind.CloseBraceToken);
        let candidate = text;
        for (const brace of [...braces].reverse()) candidate = candidate.slice(0, brace.getStart(source)) + eol + candidate.slice(brace.end);
        try
        {
          // 无分号语句可能与下一行的 (、[ 等结合；不能为了删括号改写表达式。
          assertEquivalent(source.fileName, text, candidate, { allowIfBraces: true });
          for (const brace of braces) edits.push({ start: brace.getStart(source), end: brace.end, text: eol });
        }
        catch
        {
          retain(body, 'if-syntax');
        }
      }
      else if (/[\r\n]/.test(body.getText(source)))
      {
        if (!scopeNeutralStatement(body))
        {
          retain(body, 'scope');
          continue;
        }
        // 只包裹 AST 中原本就属于该分支的语句，绝不按缩进吸入后续语句。
        edits.push({ start: body.pos, end: body.pos, text: eol + '{' + eol });
        edits.push({ start: body.end, end: body.end, text: eol + '}' + eol });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  assertEquivalent(source.fileName, text, result, { allowIfBraces: true });
  return { text: result, protectedRanges };
}

function whitespaceLayout(file, text)
{
  const expanded = layout(parse(file, text));
  const indented = indent(parse(file, expanded.text));
  const result = layout(parse(file, indented));
  assertEquivalent(file, text, result.text);
  return result;
}

/** 返回规范文本及必须保留的多行内容；不写盘，失败时调用方不能提交候选内容。 */
export function formatSource(file, original)
{
  const prepared = whitespaceLayout(file, original);
  const branches = ifBodies(parse(file, prepared.text));
  const result = branches.text === prepared.text ? prepared : whitespaceLayout(file, branches.text);
  assertEquivalent(file, original, result.text, { allowIfBraces: true });
  return { text: result.text, protectedRanges: [...result.protectedRanges, ...branches.protectedRanges] };
}

function sourceFiles(directory)
{
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error(`源码目录不接受符号链接：${file}`);
    return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

/** 全部文件通过等价与幂等检查后才写盘；检查模式始终只读。 */
export function formatSources(root = process.cwd(), write = false)
{
  const files = sourceFiles(path.join(root, 'src'));
  if (!files.length) throw Error('src 中没有可检查的源码，不能报告通过');
  const candidates = files.map(file => {
    const relative = path.relative(root, file).replaceAll('\\', '/'), original = fs.readFileSync(file, 'utf8');
    const result = formatSource(relative, original);
    const repeated = formatSource(relative, result.text);
    if (repeated.text !== result.text) throw Error(`${relative}: 格式化结果不幂等`);
    return { file, relative, original, ...repeated };
  });
  const changed = candidates.filter(item => item.original !== item.text);
  if (write) for (const item of changed) fs.writeFileSync(item.file, item.text);
  return { files: files.length, changed: changed.map(item => item.relative), violations: changed.map(item => {
    const lines = item.original.split(/\r?\n/), formatted = item.text.split(/\r?\n/);
    const first = lines.findIndex((line, index) => line !== formatted[index]);
    return { file: item.relative, line: first < 0 ? lines.length : first + 1 };
  }), protectedRanges: candidates.flatMap(item => item.protectedRanges.map(range => ({ file: item.relative, ...range }))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
  try
  {
    const args = process.argv.slice(2);
    if (new Set(args).size !== args.length || args.some(arg => !['--write', '--check', '--json'].includes(arg)) || args.includes('--write') && args.includes('--check')) throw Error('用法：node scripts/source-format.mjs [--check|--write] [--json]');
    const write = args.includes('--write'), result = formatSources(process.cwd(), write);
    if (args.includes('--json')) console.log(JSON.stringify({ ...result, mode: write ? 'write' : 'check' }));
    else
    {
      for (const item of result.violations) console.log(`${write ? '已排版' : '格式不符'}: ${item.file}:${item.line}`);
      const reasons = {};
      for (const range of result.protectedRanges) reasons[range.reason] = (reasons[range.reason] ?? 0) + 1;
      console.log(JSON.stringify({ files: result.files, changed: result.changed.length, protectedRanges: result.protectedRanges.length, reasons, mode: write ? 'write' : 'check' }));
      if (!write && result.changed.length) console.log('请运行 pnpm format:source 修正布局。');
    }
    if (!write && result.changed.length) process.exitCode = 1;
  }
  catch (error)
  {
    console.error(error.message);
    process.exitCode = 1;
  }
}
