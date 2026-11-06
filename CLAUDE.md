# CBIM 项目协作入口

开始修改前，阅读并遵循 [AGENTS.md](AGENTS.md) 中的项目协作规范。代码注释和目录类图的同步维护要求仅适用于 `src/`。

## 架构维护 Skill

- [Claude Code 入口](.claude/skills/architecture-maintenance/SKILL.md)
- [Codex 入口](.codex/skills/architecture-maintenance/SKILL.md)

修改源码、拆分或移动模块、检查依赖、更新注释与架构文档时，按上述 `architecture-maintenance` 流程执行。两份 Skill 内容保持同步，修改任一份时同步另一份。

新人可先阅读 [源码目录说明](docs/source-layout.md) 和 [src 整体架构](src/ARCHITECTURE.md)。使用 `pnpm check:architecture` 检查类图同步及包含类型引用的循环依赖；该检查不能替代对职责和注释语义的人工 review。
