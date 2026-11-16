# 工程方案与操作指南

本目录保留仍用于开发、发布和维护的方案。已完成的旧功能切片及专项验证从 [固定历史版本](../README.md#历史追溯与维护边界) 查询；当前业务实现从 [源码架构](../../src/ARCHITECTURE.md) 逐层阅读。

| 指南 | 用途 |
| --- | --- |
| [CI 验证](ci-validation.md) | 按变更路径选择检查、测试分片与汇总结果 |
| [桌面发布](desktop-release.md) | 构建、安装升级及验收进程的操作边界 |
| [C/R/E 构建与发布](desktop-runtime-release.md) | 冷包、运行资源和引擎制品的身份、签名与发布顺序 |
| [分层更新设计](desktop-hot-update-design.md) | 冷更、资源更新和独立引擎包的设计取舍 |
| [官方引擎包](engine-package-release.md) | 引擎登记、构建、兼容与更新 |
| [Windows 签名](windows-signing.md) | 签名配置和版本迁移；历史重发方案不构成新授权 |
| [GitHub 反馈连接](github-feedback-setup.md) | OAuth 配置、Device Flow 与线上验证 |
| [领域引擎架构](domain-agent-loop-engine-architecture.md) | 引擎、模型与安装职责的设计依据 |
| [品牌与官网](product-brand-website.md) | 品牌源、官网构建和真实发布信息同步 |

产品运行时读取的五份 Task 规范已归 [assets/task](../../assets/task/README.md)，本目录不保留副本，也不作为运行资料根。开发状态和优先级仍以 [GitHub Issues](https://github.com/nan023062/cbim/issues) 为准。
