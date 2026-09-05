# CBIM V1 安装参考

## 安装内容

安装器把 `v1/kernel/` 放到目标项目的 `.cbim/kernel/`，建立项目本地 Python 环境和 `.cbim/run` / `.cbim/run.cmd` 启动器，并安装：

- 可复用 Agent 定义及其私有 Skill；
- 可由清晰描述自动命中、也可由用户显式调用的主会话 Skill：`.claude/skills/`；
- 本地配置、模块注册表和基础 CLI。

V1 不安装或注册行为树、Dream、生命周期 hooks、MCP server、后台服务或操作系统调度任务，也不修改用户 home 下的 Claude 设置。不提供自动记忆捕获或自动召回。

需要 Python 3.10+ 和 Git。Shell 安装器需要 Bash；Windows 可用 Git Bash。项目本地启动器支持 POSIX 与 Windows。

## 源码开发验证

远端 `install.sh` 会下载已发布仓库版本，不会使用当前 checkout 中未提交的修改。验证本次改动时，应在临时项目中使用本地内核，并隔离 `HOME`、`USERPROFILE` 及 Claude 配置目录；不要把当前宿主项目作为测试目标。

初始化和同步操作不得覆盖用户自建 `.claude/agents/`、`.claude/skills/`、`.claude/commands/`、业务 `.dna/`、记忆或其他工具的 settings。显式升级若发现旧 CBIM 注册，只清理能明确识别的 CBIM 项，保留其他 hooks、MCP、权限和组元数据；不会注销旧操作系统任务，也不会删除运行数据。

## 部署后布局

```text
your-project/
├── .claude/
│   ├── agents/                 # 可复用专业 Agent 与私有 Skill
│   ├── skills/                 # 用户显式调用的主会话 Skill
│   └── commands/               # 手动帮助、安装和可选诊断命令
├── src/<module>/.dna/
│   ├── module.md               # 必需模块文档
│   ├── contract.md             # 可选接口契约
│   ├── notes/                  # 可选业务说明
│   └── workflows/              # 可选业务流程知识
└── .cbim/
    ├── run / run.cmd           # 本地 CLI 启动器
    ├── .venv/                  # 项目本地 Python 环境
    ├── kernel/                 # V1 内核
    ├── config.json             # 本地配置
    ├── index.md                # 模块注册表
    ├── index/                  # 衍生检索和图数据
    └── memory/                 # 用户主动管理的记忆
        └── medium/
```

项目根 `.dna/` 可选。`.dna/workflows/` 是业务知识文件，不会被 Python 自动执行。

## CLI

启动器是人类用户的本地命令入口：

```text
.cbim/run --help
.cbim/run dna list
.cbim/run agent list
.cbim/run skill list
.cbim/run memory --help
.cbim/run snapshot
.cbim/run audit list-checks
```

Windows 使用 `.cbim/run.cmd`。命令通过 service/resource 层执行受控操作，保留名称、路径、frontmatter、可执行资源、注册表、索引和原子写校验。Skill 不会改变宿主权限；如果宿主阻止命令，需由用户显式处理。

## 显式 Skills

安装后可以由用户主动调用：

- `/cbim-knowledge`：查询模块、契约、notes 和业务 workflow；
- `/cbim-code`：按用户范围定位源码；
- `/cbim-architecture`：设计或更新业务架构；
- `/cbim-development`：实现并验证明确范围的改动；
- `/cbim-memory`：保存、查询或整理用户选定的记忆。

这些入口在主会话执行，允许 Claude Code 在描述明确匹配时自动命中，也允许用户显式调用；不默认 fork、不自动派发 Agent。没有命中时使用 Claude Code 默认行为。

## 保留和不保留

保留模块 CRUD、Agent/Skill 管理、记忆文件、检索、业务图、审计和显式重建。删除旧行为树、后台治理、主动记忆采集、MCP、Dashboard 和生命周期 hooks；不会因为删除调用者而清除已有 `.dna/`、memory、索引、日志或历史执行数据。

## 卸载与旧安装

没有自动数据清理卸载器。卸载前先备份需要保留的 `.dna/`、记忆、能力资产和日志，然后只移除已确认的 CBIM 源码资产与注册。不要直接递归删除 `.cbim/`。

已有旧安装可能仍包含 hooks、MCP 注册或系统调度任务。源码同步不会代替系统级注销；请用户单独检查和处理。