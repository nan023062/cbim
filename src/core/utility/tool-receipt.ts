/** 工具回执可能是纯文本，也可能在 content 文本块内包装结构化错误。 */
export function failureText(value: unknown, depth = 0): string
{
  if (!value || depth > 12) return '';
  if (typeof value === 'string')
  {
    const text = value.trim();
    if (text.startsWith('{') || text.startsWith('['))
    {
      try { return failureText(JSON.parse(text), depth + 1); } catch { /* 普通命令输出 */ }
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(item => failureText(item, depth + 1)).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';
  const result = value as Record<string, unknown>;
  const exitCode = typeof result.exitCode === 'number' && result.exitCode !== 0 ? 'Command exited with code ' + result.exitCode : '';
  for (const key of ['message', 'error', 'reason', 'stderr', 'content', 'text'])
  {
    const text = failureText(result[key], depth + 1);
    if (text) return exitCode ? text + '\n' + exitCode : text;
  }
  return exitCode;
}

/** 只识别引擎明确报告的中止，不从普通日志里的关键词推断。 */
export function isAbortedReceipt(reason: string): boolean
{
  return /^(?:Command aborted|This operation was aborted|AbortError(?::[^\n]*)?)[.!]?$/i.test(reason.trim());
}

export function failureSummary(reason: string): string
{
  const lines = reason.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const explicit = lines.find(line => /^(?:fatal:|error:|[\w.]*Error(?:\s*\[|:))|was not found|command not found|permission denied|no such file or directory/i.test(line));
  const exit = lines.map(line => /^(?:command |process )?exit(?:ed)?(?: with)?(?: exit)? code[:= ]+(-?\d+)$/i.exec(line)).find(Boolean);
  return explicit ?? (exit ? '退出码 ' + exit[1] : lines.length === 1 ? lines[0] : '请展开查看工具回执');
}
