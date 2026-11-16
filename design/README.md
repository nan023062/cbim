# CBIM 项目设计

本目录保留仍有阅读价值的产品设计、架构方案、UX 原型和工程操作指南。通用准则在 [docs](../docs/05-工程文件组织与代码阅读设计.md)，当前实现从 [src 架构模型](../src/ARCHITECTURE.md) 逐层阅读，产品实际加载的规范与 Schema 在 [assets](../assets/README.md)。

开发清单与实时进度以 [GitHub Issues](https://github.com/nan023062/cbim/issues) 为准。方案描述目标与取舍，不证明已经实施，也不扩大当前任务授权。

## 产品与架构设计

| 设计入口 | 阅读目的 |
| --- | --- |
| [产品模型](team-workspace-network.md) · [产品需求](agent-tool-product-requirements.md) | 理解 Agent、Team、工作区与递归工具调用的目标关系 |
| [交互设计](agent-tool-ux-design.md) · [工程落地方案](agent-tool-engineering.md) | 理解统一对话、调用反馈及迁移边界；实施状态回到 Issues 与源码核实 |
| [四层架构](four-layer-architecture.md) | 理解 Core、Logic、Bridge、View 的职责与依赖方向 |
| [领域引擎设计](task/domain-agent-loop-engine-architecture.md) | 理解引擎、模型、包与装配点的分工 |
| [Agent 概念模型](capability/base-agent.md) · [Module 概念模型](business/base-module.md) | 理解产品对象；不替代真实代码类图 |

## UX 与设计资产

| 入口 | 阅读目的 |
| --- | --- |
| [UX 系统提案](cbim-ux-system-proposal.md) · [交互原型](cbim-ux-prototype.html) | 主对话与递归工具详情的设计演示 |
| [全界面设计](cbim-complete-ux-design.md) · [评审原型](cbim-complete-ux-prototype.html) | 各操作面的布局、动作、恢复与窄屏设计 |
| [图标与动效](cbim-icon-motion-system.md) · [图标母版](cbim-icon-sprite.svg) | 统一视觉语义及配套资产 |

原型只使用示例数据。配套预览、母版及生成／检查脚本继续保留，不作为产品行为验证证据。

## 工程操作与记录

- [发布、签名、CI 与反馈指南](task/README.md)：仍由开发流程使用的操作入口。
- [发布说明](releases/)：构建会读取的版本正文及资源签名公钥，保留原字节；发布正文直接引用的一份验证说明同时保留。
- [近期开发记录](development-log.md)：2026-11-16 起的实际范围、验证和限制；不是待办清单。
- [模块测试入口](../tests/README.md)：测试归属、独立夹具与按模块执行。
- [旧格式识别](business/README.md)：仅供迁移参考的 Schema；当前运行规范归 assets。

## 开发入口

| 职责 | 通用项目 | Claude Code | Codex |
| --- | --- | --- | --- |
| 从 Issues 推进已授权开发 | [cbim-development](../.agents/skills/cbim-development/SKILL.md) | [入口](../.claude/skills/cbim-development/SKILL.md) | [入口](../.codex/skills/cbim-development/SKILL.md) |
| 按变化点评估架构演进 | [architecture-evolution](../.agents/skills/architecture-evolution/SKILL.md) | [入口](../.claude/skills/architecture-evolution/SKILL.md) | [入口](../.codex/skills/architecture-evolution/SKILL.md) |
| 同步源码说明与架构模型 | [architecture-maintenance](../.agents/skills/architecture-maintenance/SKILL.md) | [入口](../.claude/skills/architecture-maintenance/SKILL.md) | [入口](../.codex/skills/architecture-maintenance/SKILL.md) |
| 验证制品并发布桌面版本 | [cbim-release](../.agents/skills/cbim-release/SKILL.md) | [入口](../.claude/skills/cbim-release/SKILL.md) | [入口](../.codex/skills/cbim-release/SKILL.md) |

三个宿主入口同名同内容。设计和开发遵守 [通用架构规范](../docs/06-通用项目架构设计规范与原则.md)，架构治理同时遵守 [治理流程](../docs/07-架构治理规范与治理流程.md)。按 [实际影响选择验证](../AGENTS.md#日常验证范围)；纯文档清理只检查内容、引用和入口一致性。

## 历史追溯与维护边界

2026-11-16 清理了已完成的旧功能切片、旧治理基线、历史验证报告及配套快照。完整原文保存在已推送的 [清理前版本](https://github.com/nan023062/cbim/tree/c3178be11e24259d99ed59db60cc4781afb15782/design)，保留文档中的历史证据链接已指向固定提交。更早开发记录同样沿该版本查询。

本机可使用 `git show c3178be11e24259d99ed59db60cc4781afb15782:design/<原相对路径>` 阅读历史原文，无须在当前目录复制旧方案。历史版本、失败与验收数字只证明当时事实，不代表当前状态。

持续维护的设计与实际使用的资源保留；完成切片与历史报告可在记录固定版本后退出当前目录。新工作的关键验证事实仍写入开发记录或对应版本报告，并回填已获授权的 Issue／PR。不能删除实际加载的规范、Schema、发布正文或独立未提交工作，也不因删除历史报告而取消产品测试或发布验收。
