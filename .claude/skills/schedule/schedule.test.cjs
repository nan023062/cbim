'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..', '..');
const skillPath = path.join(root, '.claude', 'skills', 'schedule', 'SKILL.md');
const rulesPath = path.join(root, 'CLAUDE.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md must start with frontmatter');
  return match[1];
}

test('schedule skill has discoverable metadata and receives arguments', () => {
  const skill = read(skillPath);
  const metadata = frontmatter(skill);
  assert.match(metadata, /^name:\s*schedule$/m);
  assert.match(metadata, /^description:\s*\S+/m);
  assert.match(metadata, /^argument-hint:\s*\S+/m);
  assert.match(skill, /\$ARGUMENTS/);
  assert.match(skill, /主会话/);
  assert.doesNotMatch(metadata, /context:\s*fork|allowed-tools|disable-model-invocation|user-invocable/);
});

test('skill documents all four direct Chinese and slash entry points', () => {
  const skill = read(skillPath);
  const rules = read(rulesPath);
  for (const text of ['/schedule', '定时', '提醒', '定时列表', '取消定时', 'list', 'cancel']) {
    assert.ok(skill.includes(text), `skill missing ${text}`);
  }
  assert.match(rules, /定时 <时间／周期> <任务>/);
  assert.match(rules, /提醒 <时间> <事项>/);
  assert.match(rules, /定时列表/);
  assert.match(rules, /取消定时 <完整 ID>/);
  assert.match(rules, /schedule\/SKILL\.md/);
});

test('skill requires host cron lifecycle and forbids scheduler fallbacks', () => {
  const skill = read(skillPath);
  for (const tool of ['CronCreate', 'CronList', 'CronDelete']) assert.ok(skill.includes(tool));
  for (const forbidden of ['Bash、Monitor、Node sleep', '操作系统计划任务', '外部服务', '其他会话']) {
    assert.ok(skill.includes(forbidden), `missing fallback prohibition: ${forbidden}`);
  }
  assert.match(skill, /先调用 `CronList`/);
  assert.match(skill, /完整、明确 ID 调用 `CronDelete`/);
  assert.match(skill, /不递归注册/);
});

test('skill defines time, deduplication, authorization, and lifecycle boundaries', () => {
  const skill = read(skillPath);
  for (const text of [
    '操作系统当前本地时间和时区', 'recurring: false', '*/90', '*/7',
    '提交、推送、部署和费用操作', 'next-run', '会话关闭后停止',
    '最多有效 7 天', '不自动从历史恢复', '不将任务 ID 写入 handoff、tasks',
    '不把历史档案当作正在运行的任务',
  ]) assert.ok(skill.includes(text), `missing boundary: ${text}`);
  assert.match(skill, /本会话内存/);
  assert.match(skill, /只在会话空闲时触发/);
});

test('scheduled workflow check details stay in schedule rather than the main handbook', () => {
  const skill = read(skillPath);
  const rules = read(rulesPath);
  assert.match(skill, /## 定期 AI 工作流检查/);
  for (const text of ['[AI_WORKFLOW_CHECK_RUN]', '/ai-workflow-check --scheduled-run', '不再次注册／取消调度', '检查不写报告、档案或 handoff']) {
    assert.ok(skill.includes(text), `missing scheduled check contract: ${text}`);
  }
  assert.match(rules, /schedule Skill 的“定期 AI 工作流检查”流程/);
  assert.doesNotMatch(rules, /\[AI_WORKFLOW_CHECK_RUN\]|--scheduled-run|task_id|recorded_at|supersedes/);
});

test('static contract does not claim host triggering or natural-language behavior', () => {
  const skill = read(skillPath);
  assert.match(skill, /工具不可用或被拒绝/);
  assert.match(skill, /工具未返回的字段不编造/);
  assert.doesNotMatch(skill, /已验证到点|保证准时|自然语言已命中/);
});

// These tests check repository text only; they do not prove model routing,
// host-tool availability, reminder delivery, or exact trigger timing.
