> 2026-11-05 迁移说明：本文保留的 Python 命令属于历史实现，新助手不调用它们。现行运行入口为桌面应用与 `pnpm cli --root "<工程根>"`；迁移范围见工程 `docs/rule-migration.md`。

---
name: create-agent-skill
description: 为已有 CBIM Agent 或 Team 新建专业 Skill，编写 SKILL.md、添加可复用工具并登记所属节点的 skills 清单。不创建 Agent，也不用于模块 Workflow 或宿主 Skill 安装。
---

# 新建 Agent 或 Team Skill

输入：所属 Agent 或 Team 目录、专业方法目标、适用任务与有效维护授权。产出：`skills/<skill-name>/SKILL.md`、所属清单及验证结果。

1. 按[任务基线](../../task/task-baseline.md)记录实际使用的定义与依据。通过[任务上下文](../../task/task-spec.md)接收调用方提供的 Agent 规范及其版本，缺少时返回输入缺口；依据该规范核对目标 Agent 的 `agent.json` 或 Team 的 `skills.json`、相关工作原则和完整祖先共享清单，核实专业能力、局限及是否已有等价方法。已有方法优先复用；涉及职责或原则变更时返回调用方，不用新增 Skill 暗中扩大能力或授权。
2. 先确定方法所有权：只有专属能力放入 Agent；多成员共享的方法放入最近共同 Team，所有团队共享则放入 team 根。Team 可以任意层级嵌套，不把部门层级压平，也不重复登记继承方法。明确真实触发请求与不适用范围，编写 YAML frontmatter 的 `name`、`description`。目录与 name 使用相同的小写连字符名称。正文描述输入、方法步骤、判断依据、结果校验、失败退出和交付要求，遵守 Agent 工作原则；具体业务设计引用所属模块知识，不硬编码特定模块绑定。
3. 可重复的确定性操作使用已有工具；确需新增则存入本 Skill 的 `scripts/` 并测试正常与失败路径。按需创建 references/ 或 assets/，由正文说明何时加载；不生成空目录、占位示例或重复规则。Skill 声明不表示工具已安装或拥有执行授权。
4. 把完整 SKILL.md 写入本次任务记录的输入文件。下面的固定入口默认预览，加 `--write` 后创建并登记 name、purpose、reference；不生成新的 Agent，Team owner 写入同级 skills.json，Agent owner 写入 agent.json；不向其他 Agent 清单或宿主安装目录写入。

```powershell
python -B design/skills/create-agent-skill/scripts/create_agent_skill.py --root "<工程根>" --owner <Agent或Team目录> --slug <skill-name> --name "<专业方法名称>" --purpose "<适用用途>" --content <正文文件>
# 已有新增授权时，同一命令加 --write 落盘。
```

5. 核对所属节点的 skills 清单及受影响 Agent 的完整继承链与实际入口一一对应，检查最终位置的相对引用。运行 `python -B design/scripts/maintain_registries.py --root "<工程根>" --check`，索引确有变化才使用 `--write` 后重新检查。用适用请求、不适用请求、输入缺失场景走读，实际执行新脚本测试；不能以格式通过代替专业方法有效性。
6. 返回入口、清单变化、适用边界、测试证据和未验证项。脚本退出 0 表示预览或写入完成，1 表示失败；拒绝覆盖、越界、重复、空正文和无效所属定义。失败时根据错误核对现状后重试。需要其他治理时向调用方返回证据，由入口路由，不直接调用其他 Skill。
