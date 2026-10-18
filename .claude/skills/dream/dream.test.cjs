'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const skill = read('.claude/skills/dream/SKILL.md');

test('dream metadata and root route default to reviewed proposals', () => {
  assert.match(skill, /^---\r?\nname: dream\r?\n/);
  assert.match(skill, /argument-hint: "[^"\r\n]+"/);
  assert.match(skill, /\$ARGUMENTS/);
  assert.match(skill, /主会话/);
  assert.match(read('CLAUDE.md'), /当前明确确认后才合并/);
  assert.match(read('CLAUDE.md'), /\.claude\/skills\/dream\/SKILL\.md/);
});

test('dream separates knowledge destinations and leaves ambiguous or sensitive changes for review', () => {
  for (const text of ['默认生成待审提案，不修改知识', '不回溯旧聊天', '不定时',
    '不复制给所有角色', '所属模块 CLAUDE.md', '单列根手册／Skill 建议',
    '一次性、归属不明或有冲突', '不得修改 frontmatter', '不接产品运行时']) assert.ok(skill.includes(text), text);
});

test('dream requires full scan, specific current confirmation and version revalidation', () => {
  for (const text of ['最近三条档案代替全量候选', 'scan_complete', 'next_cursor', '检查不完整',
    '历史确认', '不是本轮授权', '重新全量汇总', 'SHA-256', '重新预览',
    '只读／计划模式不写提案、档案、handoff 或缓存', '不是权限沙箱']) assert.ok(skill.includes(text), text);
});

test('apply records actual partial outcomes without duplicate editing or permission expansion', () => {
  for (const text of ['先通过归档器写 started', '失败则不修改目标', '保存 finished',
    '不重复编辑', '不自动回滚用户改动', '文件已修改，回执未确认', '暂停后续批次',
    '不委派子 Agent 改 Agent 定义或共享记忆', '不是事务', '无提交、推送、调度授权',
    '/reload-skills', '静态契约测试不证明']) assert.ok(skill.includes(text), text);
});

// These are workflow-text checks, not model behavior or authorization tests.
