'use strict';

const fs = require('node:fs');

const reason = '请由主 Agent 根据本轮实际执行情况核对项目内的 .claude/memory/handoff.md：记录实际修改、完成与未完成项、验证成功／失败／未运行、已确认决定和下一步；需要时补充或修正，已有内容充分则不重复写、不仅刷新时间。不得把计划或未执行操作写成完成。计划模式、用户明确只读和权限限制优先；写入被拒绝或不可用时不得绕过，在最终回复说明记忆未更新及原因。有实质修改、确认决策、验证结果或值得保留的阻塞时，先使用 .claude/hooks/task-archive.cjs 归档事实，再更新交接快照；格式见该脚本 validate。相同快照复用 task_id、recorded_at 和完整内容，幂等重试；后续实质进展用新 ID 与 supersedes 关联，不覆盖旧档案。普通问答、纯提醒和重复核对不因 Stop 次数生成档案。归档与快照不是事务，部分失败须如实说明。本 Hook 不自动保存或验证事实。收尾由主 Agent 完成，不派发子 Agent 写共享记忆；核对后结束。';

function evaluate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.hook_event_name !== 'string') {
    throw new Error('Invalid hook input');
  }
  if (input.hook_event_name !== 'Stop') return null;
  if (input.permission_mode === 'plan') return null;
  if (typeof input.stop_hook_active !== 'boolean') {
    throw new Error('Invalid stop_hook_active');
  }
  if (input.stop_hook_active) return null;
  return { decision: 'block', reason };
}

if (require.main === module) {
  try {
    const decision = evaluate(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (decision) process.stdout.write(JSON.stringify(decision) + '\n');
  } catch {
    // Non-blocking failure: never echo the payload or transcript path.
    process.stderr.write('memory-stop: invalid or unreadable hook input; memory check skipped.\n');
    process.exitCode = 1;
  }
}

module.exports = { evaluate };
