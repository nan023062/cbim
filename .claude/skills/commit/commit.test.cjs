'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const skillPath = path.join(root, '.claude', 'skills', 'commit', 'SKILL.md');
const rulesPath = path.join(root, 'CLAUDE.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md must start with frontmatter');
  return match[1];
}

test('commit skill has discoverable metadata, arguments, and main-session execution', () => {
  const skill = read(skillPath);
  const metadata = frontmatter(skill);
  assert.match(metadata, /^name:\s*commit$/m);
  assert.match(metadata, /^description:\s*\S+/m);
  assert.match(metadata, /^argument-hint:\s*"[^"\r\n]+"$/m);
  assert.match(skill, /\$ARGUMENTS/);
  assert.match(skill, /主会话/);
  assert.doesNotMatch(metadata, /context:\s*fork|allowed-tools|disable-model-invocation|user-invocable/);
});

test('root rules route direct commit entry points to the same skill', () => {
  const skill = read(skillPath);
  const rules = read(rulesPath);
  assert.match(skill, /`\/commit` 与中文“提交／提交代码”使用同一流程/);
  assert.match(rules, /“提交／提交代码”或 `\/commit` → `\.claude\/skills\/commit\/SKILL\.md`/);
});

test('commit authorization boundaries distinguish direct requests, arguments, history, and scheduled work', () => {
  const skill = read(skillPath);
  const rules = read(rulesPath);
  for (const text of [
    '仅用户直接请求触发',
    '讨论、引用、示例、历史档案、到期提醒正文，以及创建或测试本 Skill，都不是新的提交授权',
    '定时任务不自动继承本入口的提交与 push 授权',
    '参数只表达范围和限制，不作为任意 shell 命令执行',
  ]) assert.ok(skill.includes(text) || rules.includes(text), `missing authorization boundary: ${text}`);
});

test('commit workflow requires repository, branch, worktree, staging, and upstream review', () => {
  const skill = read(skillPath);
  for (const text of [
    '核对当前仓库、分支、工作区、已有暂存区、upstream 和远端目标',
    '读取适用的根及模块 CLAUDE.md',
    '先检查实际差异、暂存差异和新文件内容',
    '只暂存已审查且属于授权范围的具体文件',
    '提交前再次核对暂存差异',
    '发现期间出现的未知改动先检查',
    '推送前再次核对分支和远端',
    '已有 upstream 时使用对应远端分支',
    '无 upstream 时仅在目标明确后建立跟踪',
  ]) assert.ok(skill.includes(text), `missing review boundary: ${text}`);
});

test('commit workflow protects scope, credentials, history, hooks, and default branches', () => {
  const skill = read(skillPath);
  for (const text of [
    '不盲目添加整个目录',
    '不发布密钥、本地凭证或会话日志',
    '显式范围与已有暂存区冲突时，先说明并确认如何处理',
    '不擅自重置或夹带范围外内容',
    '默认分支上先建工作分支',
    '不自动合并到默认分支',
    '不重写已有提交',
    '不强制推送、不绕过 Git hooks 或签名',
    '远端冲突时停止，不强推、不擅自解决冲突或改写历史',
  ]) assert.ok(skill.includes(text), `missing safety boundary: ${text}`);
});

test('commit workflow stops on failed validation, sensitive content, permission refusal, or hook failure', () => {
  const skill = read(skillPath);
  for (const text of [
    '根据改动执行必要验证，区分运行测试、静态检查和未验证项',
    '验证失败、发现敏感内容或权限拒绝时，停止相关提交／推送步骤并说明',
    'hook 失败先分析原因，不使用跳过参数',
    '不换工具绕过',
  ]) assert.ok(skill.includes(text), `missing failure-stop boundary: ${text}`);
});

test('commit workflow documents push authorization and no-op outcomes separately', () => {
  const skill = read(skillPath);
  assert.match(skill, /默认表示检查当前仓库改动、执行必要验证、提交并推送/);
  assert.match(skill, /明确“只提交、不推送”时不得执行上述推送/);
  assert.match(skill, /无新改动但有待推送提交时/);
  assert.match(skill, /无改动也无待推送提交时说明无需操作/);
  assert.match(skill, /不把提交成功当作推送成功/);
});

// These tests inspect repository text only; they do not perform commits or
// prove authorization, staging, hook, remote, or push behavior at runtime.
