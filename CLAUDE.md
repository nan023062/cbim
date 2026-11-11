# CBIM 项目协作入口

开始修改前，阅读并遵循 [AGENTS.md](AGENTS.md) 中的项目协作规范。代码注释和目录类图的同步维护要求仅适用于 `src/`。

开发 Skill 必须读取并遵守 [文档 1：通用项目架构设计规范与原则](design/project-architecture-standard.md)；项目架构治理入口 `architecture-evolution` 必须同时读取文档 1 和 [文档 2：架构治理规范与治理流程](design/architecture-governance-process.md)，按文档 2 的标准流程执行。架构资料维护遵守文档 1，并衔接文档 2 的验证与认知交付；普通开发不机械启动完整治理。

## 持续开发 Skill

开发清单从 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取，关联方案与记录见 [design/](design/README.md)，四份概念设计见 [设计文档](README.md#设计文档)。继续开发或处理 Issue 时，使用 `cbim-development`：

- [Claude Code 入口](.claude/skills/cbim-development/SKILL.md)
- [Codex 入口](.codex/skills/cbim-development/SKILL.md)
- [通用项目入口](.agents/skills/cbim-development/SKILL.md)

先核实仓库和 Issues 清单，再读取选定 Issue、相关开发记录与当前代码，明确本步范围与验收；每个 Issue 独立开发、验证和提交，在已有授权内回填进度与证据。三个入口内容一致；修改源码时同时执行下方架构维护流程。

日常验证按 [AGENTS.md 的验证范围](AGENTS.md#日常验证范围)：只测受影响单元及直接相关契约，通过后记录并提交；静态检查按实际变化选择，全量回归留给后续 PR 自动化，制品验收留给集成／发布阶段。纯文档与 Skill 修改只核对资料一致性。

## 桌面发布 Skill

发布新版、投放更新通道、签名迁移或恢复中断发布时，使用 `cbim-release`；纯方案讨论不执行外部写入。

- [Claude Code 入口](.claude/skills/cbim-release/SKILL.md)
- [Codex 入口](.codex/skills/cbim-release/SKILL.md)
- [通用项目入口](.agents/skills/cbim-release/SKILL.md)

三个入口及引用资料同步维护。复用现有构建和校验工具，先核实冻结制品与草稿状态，再完成隔离安装、完整 CI、公开升级、官网及分支收尾；具体操作与恢复门槛见 Skill。

## 架构维护 Skill

- [通用项目入口](.agents/skills/architecture-maintenance/SKILL.md)
- [Claude Code 入口](.claude/skills/architecture-maintenance/SKILL.md)
- [Codex 入口](.codex/skills/architecture-maintenance/SKILL.md)

修改源码、拆分或移动模块、检查依赖、更新注释与架构文档时，按上述 `architecture-maintenance` 流程执行。通用项目、Claude Code 和 Codex 三个入口内容保持同步。

新人先从 [src 整体架构](src/ARCHITECTURE.md) 下钻相关目录的 `ARCHITECTURE.md` 与 `CONTRACT.md`，结合源码核实当前实现。使用 `pnpm check:architecture` 检查类图同步及包含类型引用的循环依赖；该检查不能替代对职责和注释语义的人工 review。
