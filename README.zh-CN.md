# CBIM

[English](README.md) | [中文](README.zh-CN.md)

CBIM（Capability–Business Independence + Memory）分离**可移植能力**（Agent 与 Skill）、**项目业务知识**（模块 `.dna/`）和**用户明确保存的记忆**。

[V1](v1/) 基于 Claude Code，以可自动命中或用户显式调用的主会话 Skill 和本地 Python 数据层工作。[V2](v2/) 是独立实现，本次 V1 简化不改变 V2。

## V1 工作方式

- **不调用 Skill：走 Claude Code 默认逻辑。** CBIM 不自动分类、路由、派发或检查普通请求。
- **命中 Skill：主会话执行。** Claude Code 会在描述明确匹配时自动命中 Skill，用户也可以显式调用；没有命中时走 Claude Code 默认逻辑。专业 Agent 是可复用能力，不是必经步骤。
- **记忆由用户主动发起。** 明确要求后才保存、查询或整理，不捕获普通会话，不主动召回、蒸馏、晋升或删除来源。
- 不再有行为树、后台治理、生命周期 hooks、MCP 服务或定时启动 Claude 的流程。
- 保留资源管理、格式与路径校验、原子写、模块注册表、检索、业务图和手动审计。

目标是验证能力与业务分离能否减少工作阻力，而不是承诺固定上下文大小或必然提高准确率。

## 显式 Skills

| 入口 | 用途 |
|---|---|
| `/cbim-knowledge` | 查询模块、契约、notes 和业务流程知识 |
| `/cbim-code` | 定位并解释用户指定范围的源码 |
| `/cbim-architecture` | 为明确需求设计或更新业务架构 |
| `/cbim-development` | 实现和验证改动，不强制委派子 Agent |
| `/cbim-memory` | 显式保存、查询或整理选定记忆 |

原生入口安装于 `.claude/skills/<name>/SKILL.md`，设置 `user-invocable: true`，不设置 `disable-model-invocation` 或 `context: fork`。Claude Code 会在描述明确匹配时自动命中 Skill；没有命中时走默认逻辑。Agent 私有技能与 Python 内置方法文本仍是独立机制。

示例：`/cbim-knowledge 解释支付模块的接口契约`。这不隐含读取记忆或启动架构师。

## 安装与升级

需要 Python 3.10+、Git、Claude Code；Shell 安装器需要 Bash，包括 Windows Git Bash。项目本地启动器支持 POSIX 与 Windows。

**源码版本：**先检查当前 checkout 的 `install.sh`，按[安装参考](v1/docs/INSTALL.zh-CN.md)操作。远端 `master` 安装器安装的是已发布分支，不是本地未提交源码；本次改动发布前不能用远端下载验证它。

安装将 `v1/kernel/` 放到选定项目 `.cbim/kernel/`，创建项目本地 Python 环境、启动器、能力资产和显式 Skills。不安装 MCP，不注册生命周期 hooks，不启动服务，不修改全局 Claude 设置。用户已有权限继续生效。

用户可在终端运行 `.cbim/run --help`（Windows：`.cbim/run.cmd --help`）查看实际命令。PATH 上没有全局 `cbim` 命令。Skill 不授予额外权限；宿主拒绝入口时报告限制，不删除 deny、不换路径访问同一受限数据。

**旧安装：**用户主动同步时，可以清理能明确识别的 CBIM 项目注册，保留其他工具和用户设置。不会注销操作系统任务或删除运行数据。已有系统任务和自定义协调器指令需单独检查。改源码不等于升级宿主项目。

**卸载：**先备份记忆、业务知识、能力资产和需要保留的历史记录，再移除已核实的 CBIM 可执行资产与注册。不要把递归删除 `.cbim/` 当作常规卸载步骤，其中不只有代码。没有自动清空数据的过程。

## 数据布局

```text
project/
├── .claude/
│   ├── agents/                 # 专业能力与私有 Skills
│   ├── skills/                 # 显式主会话入口
│   └── commands/               # 手动安装、帮助与诊断命令
├── src/<module>/.dna/
│   ├── module.md               # 必需：模块元数据与架构
│   ├── contract.md             # 可选：接口契约
│   ├── notes/                  # 可选：业务说明
│   └── workflows/              # 可选：业务流程知识
└── .cbim/
    ├── run / run.cmd           # 本地启动器
    ├── .venv/                  # 项目 Python 环境
    ├── kernel/                 # V1 安装源码
    ├── config.json
    ├── index.md                # 模块注册表
    ├── index/                  # 衍生检索／业务图数据
    └── memory/medium/          # 用户主动保存的记忆
```

项目根 `.dna/` 可选。业务 workflows 是知识文件，不是自动派发树。历史 short、候选区、日志及旧执行状态不自动迁移或删除。

## 保留的手动能力

- Agent／Skill 管理，资源文件和可执行资源声明。
- 模块、契约、note、workflow 管理，以及拆分、快照和重建。
- 记忆保存、查找、健康检查和显式维护。
- BM25 文本检索与业务图查询。可选后端保留；retrieval 的 Local/OpenAI embedding 提供器目前是未接通的占位实现，与独立 Chroma 记忆后端不同。
- 只读审计、可选基线管理。

用户主动写入后的索引同步是该次操作的一致性要求，不是自动治理。同步失败应明确反馈，不再依赖后台修复。

## 开发验证

测试位于 `v1/tests/`。使用隔离的临时项目和 home 路径，不接触已有安装。真实 Claude 集成测试是可选项，与普通单元测试分开。Git hooks 和持续集成继续作为开发工具，不是 CBIM 运行时触发器。

- [V1 架构](v1/docs/ARCHITECTURE.zh-CN.md)
- [安装参考](v1/docs/INSTALL.zh-CN.md)
- [模块知识格式](v1/docs/MODULE-MD-DESIGN.zh-CN.md)
- [显式记忆](v1/docs/MEMORY-REDESIGN.zh-CN.md)
- [异常处理](v1/docs/EXCEPTION-GOVERNANCE.zh-CN.md)

## 许可

[MIT](LICENSE)
