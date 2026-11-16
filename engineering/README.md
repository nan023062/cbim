# 工程维护

本目录承接开发操作、记录、发布资料和兼容参考；产品目标、核心取舍、未落地设计和原型仍归 [design](../design/README.md)，当前实现归 [src](../src/ARCHITECTURE.md)，通用标准归 [docs](../docs/05-工程文件组织与代码阅读设计.md)。

## 操作指南

| 入口 | 用途 |
| --- | --- |
| [CI 验证](guides/ci-validation.md) | 路径分流、测试分片和结果汇总 |
| [桌面发布](guides/desktop-release.md) | 构建、安装升级与验收进程 |
| [C/R/E 构建发布](guides/desktop-runtime-release.md) | 制品身份、签名和更新顺序 |
| [引擎包发布](guides/engine-package-release.md) | 官方引擎的构建、兼容和投放 |
| [Windows 签名](guides/windows-signing.md) | 签名配置及历史迁移边界 |
| [GitHub 反馈](guides/github-feedback-setup.md) | OAuth、Device Flow 与验证步骤 |
| [品牌与官网](guides/product-brand-website.md) | 品牌源、构建与发布信息同步 |

指南中的历史版本、实验和未完成验收只证明当时事实。执行时以当前工具、源码和实际回执为准，不将历史写入示例视为新的外部操作授权。

## 记录与发布输入

- [开发记录](development-log.md)：实际变更、验证与限制；实时待办只放 [Issues](https://github.com/nan023062/cbim/issues)。
- [发布正文与公钥](releases/)：从原设计目录原字节迁移。Forge 默认读取与目标桌面版本匹配的正文，仍支持 CBIM_DESKTOP_NOTES 覆盖；其他版本用于历史追溯。
- [0.1.10 正文引用的验证说明](verification/desktop-update-prefetch-differential-20261112.md)：保留相对位置，使既有发布正文无须改写。新增必要报告也在 verification/，已无当前用途的旧报告按固定版本追溯。
- [旧 Module Schema](compatibility/module.legacy.schema.json)：仅用于手工识别历史格式；不注册为当前运行 Schema，不加入产品资源包。当前规范在 [assets/business](../assets/business/README.md)。

路径迁移不覆盖远端发布、不重签公钥、不改写冻结制品。构建配置属于冷基础指纹输入；路径修改后仍须遵守 COLD_BASE_CHANGED 检查，不修改旧基线绕过。

## 开发入口

| 职责 | 通用项目 | Claude Code | Codex |
| --- | --- | --- | --- |
| 从 Issues 推进开发 | [cbim-development](../.agents/skills/cbim-development/SKILL.md) | [入口](../.claude/skills/cbim-development/SKILL.md) | [入口](../.codex/skills/cbim-development/SKILL.md) |
| 按变化点评估架构 | [architecture-evolution](../.agents/skills/architecture-evolution/SKILL.md) | [入口](../.claude/skills/architecture-evolution/SKILL.md) | [入口](../.codex/skills/architecture-evolution/SKILL.md) |
| 维护源码说明与模型 | [architecture-maintenance](../.agents/skills/architecture-maintenance/SKILL.md) | [入口](../.claude/skills/architecture-maintenance/SKILL.md) | [入口](../.codex/skills/architecture-maintenance/SKILL.md) |
| 验证并发布桌面版本 | [cbim-release](../.agents/skills/cbim-release/SKILL.md) | [入口](../.claude/skills/cbim-release/SKILL.md) | [入口](../.codex/skills/cbim-release/SKILL.md) |

三个宿主同名内容同步。按 [实际影响选择验证](../AGENTS.md#日常验证范围)；没有源码行为变化时，不机械运行产品测试或构建。

## 历史追溯与维护边界

本次收敛前的完整原文见 [固定版本](https://github.com/nan023062/cbim/tree/8c06ff1edacbb296efb994e80eb941a811a1aa8c/design)，更早方案与验证见 [首次清理前版本](https://github.com/nan023062/cbim/tree/c3178be11e24259d99ed59db60cc4781afb15782/design)。不复制一套本地历史归档；新记录如实标注未运行项，旧“下一步”不成为当前任务。
