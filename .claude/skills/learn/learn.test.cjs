'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const skill = read('.claude/skills/learn/SKILL.md');

test('learn metadata and root routes describe direct feedback capture without extra remember command', () => {
  assert.match(skill, /^---\r?\nname: learn\r?\n/);
  assert.match(skill, /argument-hint: "[^"\r\n]+"/);
  assert.match(skill, /\$ARGUMENTS/);
  assert.match(skill, /主会话/);
  const rules = read('CLAUDE.md');
  for (const text of ['.claude/skills/learn/SKILL.md', '无需另说“记住”', '不后台补写']) assert.ok(rules.includes(text));
});

test('capture keeps origin, privacy, duration and permission boundaries explicit', () => {
  for (const text of ['启用后采集', '不扫描旧聊天', '不是新的用户反馈', '子 Agent 只返回素材',
    '不泛化为永久禁令', '只读、计划模式', '不落盘', '不保存完整聊天、密钥、私有推理',
    '不伪造宿主消息 ID', '不是长期规则', '不自动删除已晋升知识']) assert.ok(skill.includes(text), text);
});

test('capture reuses immutable archives and separates semantic judgment from tested code', () => {
  for (const text of ['learning-review.cjs', 'task-archive.cjs', 'loadRecord', 'created／unchanged',
    '相同核心且同范围', 'action: revise', 'action: withdraw', '未保存', '绝不遗漏',
    '/reload-skills', '不提交、不推送、不创建调度']) assert.ok(skill.includes(text), text);
  const format = read('.claude/skills/learn/record-format.md');
  for (const text of ['task_id#entry_id', '32 KiB', 'started', 'finished', 'before_sha256',
    'after_sha256', '旧版归档器不保证', '不是待采集的真实反馈']) assert.ok(format.includes(text), text);
});

// Text contracts do not prove model classification or host discovery.
