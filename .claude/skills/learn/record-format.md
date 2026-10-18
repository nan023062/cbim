# 学习记录格式

以 `.claude/hooks/task-archive.cjs` 的 validate 为准。本页是构造指南，不是新事实库。新增 `learning` 为可选字段；旧 schema_version: 1 档案不迁移，旧版归档器不保证能读新扩展。

完整任务仍须包含 task_id（UTC 日期＋UUID v4）、recorded_at（同 UTC 日期、毫秒 ISO）、title、summary、status、modules、roles、changes、decisions、verification、open_items。summary 简述“含学习材料”；verification 只记录实际检查，不把候选当验证成功。

```json
{
  "learning": {
    "version": 1,
    "entries": [{
      "id": "f1",
      "kind": "feedback",
      "action": "add",
      "category": "requirement",
      "source": {
        "origin": "direct_user",
        "form": "paraphrase",
        "evidence": "用户短反馈的脱敏概述（仅格式示例，不是待采集的真实反馈）"
      },
      "core": "保留条件的核心要求",
      "scope": { "duration": "unknown", "paths": [] },
      "route": "suggestion"
    }]
  }
}
```

- 引用形式：`task_id#entry_id`。entry_id 匹配 `[a-z][a-z0-9_-]{0,31}`，同档案唯一。每份 1–16 条，完整档案最多 32 KiB（UTF-8）；超限拆分，不截断证据或补丁。
- 引用必须指向此前已归档的正确类型，不能引用自己或同档案兄弟条目；因此 feedback、proposal、started、finished 分阶段落盘。
- feedback：action 为 add／revise／withdraw；后两者必须有 previous。category 为 problem／prohibition／requirement。evidence 最多 400 字符，core 最多 800。duration 为 task／module／global／unknown；module 必须有 paths，所有路径为仓库相对路径。route 为 capability／business／suggestion。
- proposal：字段为 id、kind、sources（1–16 个反馈引用）、target、before_sha256、after_sha256、context、edits、reason。一个提案一个现有目标；context 为 `{path, sha256}` 数组，必须包含根 CLAUDE.md 及所有实际存在的目标祖先 CLAUDE.md，不含目标本身。edits 为 `{old, new}` 数组，依次替换且 old 唯一匹配；每段最多 8000 字符。目标只能是 `.claude/agents/<角色>.md` 或非隐藏业务目录内的 CLAUDE.md，根文件不属于 apply 目标。
- SHA-256 针对完整 UTF-8 文件（包括原有 BOM／换行），不能先规范化换行再计算。before 与 after 必须不同。使用 Node crypto.createHash('sha256')，提案引用绑定不可变完整内容；工具只检查哈希、关联与范围，不证明用户授权。
- result started：id、kind: result、phase: started、proposal、confirmation（当前直接确认的脱敏概述，最多 400 字符）。历史 confirmation 不是执行凭证。
- result finished：id、kind: result、phase: finished、proposal、attempt（started 引用）、outcome、detail，可有 observed_sha256。outcome 为 applied／already_present／failed／blocked／uncertain／declined；成功两种必须提供等于提案 after_sha256 的实际 hash。不能只填预期 hash 冒充实测。
- 没有真实写入尝试的拒绝／暂缓可以留在任务 decisions 和 open_items，不需要伪造 started；候选仍可见，下次 Dream 必须阅读关联任务的决定，不冒称已合并。

保存入口保持 `node .claude/hooks/task-archive.cjs` 的 stdin JSON。返回 created／unchanged 后加载核验；Windows 使用能保持 UTF-8 的传入方式。工具拒绝或权限不足时停止，不换工具绕过，不把示例当真实反馈写入。
