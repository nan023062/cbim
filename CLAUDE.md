# CBIM 项目协作入口

开始修改前，阅读并遵循 [AGENTS.md](AGENTS.md) 中的项目协作规范。代码注释和目录类图的同步维护要求仅适用于 `src/`。

## 持续开发 Skill

开发计划入口为 [design/](design/README.md)，概念设计入口为 [docs/](docs/README.md)。继续开发或按路线图实现时，使用 `cbim-development`：

- [Claude Code 入口](.claude/skills/cbim-development/SKILL.md)
- [Codex 入口](.codex/skills/cbim-development/SKILL.md)
- [通用项目入口](.agents/skills/cbim-development/SKILL.md)

先回顾全局 roadmap 和上一步成果，再明确本步范围与验收；每完成一步及时同步路线图状态及开发记录。三个入口内容一致；修改源码时同时执行下方架构维护流程。

## 桌面发布 Skill

发布新版、投放更新通道、签名迁移或恢复中断发布时，使用 `cbim-release`；纯方案讨论不执行外部写入。

- [Claude Code 入口](.claude/skills/cbim-release/SKILL.md)
- [Codex 入口](.codex/skills/cbim-release/SKILL.md)
- [通用项目入口](.agents/skills/cbim-release/SKILL.md)

三个入口及引用资料同步维护。复用现有构建和校验工具，先核实冻结制品与草稿状态，再完成隔离安装、完整 CI、公开升级、官网及分支收尾；具体操作与恢复门槛见 Skill。

## 架构维护 Skill

- [Claude Code 入口](.claude/skills/architecture-maintenance/SKILL.md)
- [Codex 入口](.codex/skills/architecture-maintenance/SKILL.md)

修改源码、拆分或移动模块、检查依赖、更新注释与架构文档时，按上述 `architecture-maintenance` 流程执行。两份 Skill 内容保持同步，修改任一份时同步另一份。

新人可先阅读 [源码目录说明](docs/source-layout.md) 和 [src 整体架构](src/ARCHITECTURE.md)。使用 `pnpm check:architecture` 检查类图同步及包含类型引用的循环依赖；该检查不能替代对职责和注释语义的人工 review。
