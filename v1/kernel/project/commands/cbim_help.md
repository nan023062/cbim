---
description: Show the CBIM V1 commands and architecture overview
---

Display the following overview to the user in Chinese:

# CBIM V1 总览

CBIM 将可复用能力（Agent、Skill、能力资源）与项目业务知识（`.dna/` 模块）分离，
并提供仅在用户明确要求时使用的本地 memory。

## 工作方式

- Claude Code 默认处理普通请求。
- 任务描述清晰匹配时，Claude Code 可以自动命中 CBIM 原生 Skill；用户也可以显式调用。
- Skill 在主会话中执行，不启动固定 Agent 链、子代理调度器或后台服务。
- 没有匹配的 Skill 时，不经过 CBIM 路由，直接使用默认行为。
- memory 不会因 Skill 命中而自动读取或写入；必须由用户明确要求。

## Slash Commands

| 命令 | 作用 |
|---|---|
| `/cbim_help` | 显示本帮助 |
| `/cbim_install` | 在当前项目安装或刷新 V1 kernel 与原生 Skills |
| `/cbim_debug on\|off\|status` | 切换显式调试标志 |

## CLI domains

| 域 | 用途 |
|---|---|
| `memory` | 用户主动执行记忆创建、查询、删除、清理和重建索引 |
| `dna` | 管理业务模块、notes、workflows、contract 和索引 |
| `agent` | 管理可复用 Agent 定义 |
| `skill` | 管理可复用 Skill 与能力资源 |
| `soul` | 查看 Agent 模板 |
| `audit` | 用户主动执行只读检查 |
| `config` | 管理项目本地配置 |
| `debug` | 查看或切换显式调试状态 |

CLI 是 service/resource 层的显式入口，不是任务调度器。所有受控写入都保留路径、
frontmatter、schema、原子写和索引校验。

## 重要路径

- `v1/kernel/`：CBIM V1 源码
- `.dna/`：项目业务知识
- `.claude/agents/`：Agent 定义
- `.claude/skills/`：主会话 Skills
- `.claude/commands/`：slash command 定义
- `.cbim/memory/`：项目本地 memory 数据

V1 不提供行为树、Dream 自动治理、生命周期 hooks、MCP server、Dashboard、后台调度
或自动记忆捕获。已有历史数据和用户配置不会因为安装或同步而被删除。