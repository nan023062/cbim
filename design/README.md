# CBIM 项目设计

本目录只保留**产品目标、核心取舍、未落地设计和原型**。设计回答“要解决什么问题、为何这样选择”，不承担当前实现清单、操作手册或开发流水账。

## 产品目标

- [产品模型](product-model.md)：Agent、Team、Module 与工作区各自表达什么。
- [Agent 工具调用需求](agent-tool-product-requirements.md)：统一执行模型、递归调用和可观察的验收目标。
- [统一对话交互](agent-tool-ux-design.md)：主对话、工具展开、调用方反馈与窄屏导航。

## 核心取舍

- [四层架构](four-layer-architecture.md)：技术机制、业务规则、可信宿主与界面的职责边界。
- [Agent 调用设计](agent-call-design.md)：身份、执行循环、调度、资源交接和取消为何分开。
- [领域引擎设计](engine-design.md)：引擎与模型解耦，静态登记、独立包和冻结运行的取舍。
- [分层更新设计](update-design.md)：C/R/E 的变化边界与保守恢复原则。

这些选择可能已经部分或全部落地；当前结构沿 [源码架构模型](../src/ARCHITECTURE.md) 阅读，不在此复制实现细节或持续维护迁移进度。

## 未落地设计与原型

- [全界面设计评审稿](cbim-complete-ux-design.md)：保留页面方案与聚合／扩展提案；每页设计不等于产品已实现。
- [图标与动效设计](cbim-icon-motion-system.md)：视觉语义、母版和交互反馈。
- [统一对话原型](cbim-ux-prototype.html) · [全界面原型](cbim-complete-ux-prototype.html)：使用示例数据进行设计评审。
- [图标母版](cbim-icon-sprite.svg) · [调用预览](agent-tool-mobile-preview.png) · [布局预览](cbim-ux-office-preview.png) · [图标预览](cbim-ux-icons-preview.png)：配套设计资产。

原型的生成和只读检查脚本随原型保留。检查通过仅表示原型内部一致，不代表真实产品交互、授权或发布通过。未落地内容是设计候选，是否实施及当前进度以 [Issues](https://github.com/nan023062/cbim/issues) 和实际任务授权为准。

## 资料归属与历史

工程资料目录已删除，不再搬到另一目录。操作流程沿现有项目 Skill 与工具维护，变更和验证事实记录在 Git 提交及关联 Issue／PR；完整删除前内容可用 `git show 4bedbca45d1e3b5f7992b21c4a82ce658cfc98e6:<原仓库相对路径>` 本地追溯。该提交尚未推送时，不把它当作在线阅读入口。通用标准在 [docs](../docs/05-工程文件组织与代码阅读设计.md)，产品运行规范由[各业务模块代码常量](../src/logic/knowledge/rules/builtins.ts)提供，品牌等独立资源在 [assets](../assets/)。

本次收敛前的设计正文可查 [固定历史版本](https://github.com/nan023062/cbim/tree/8c06ff1edacbb296efb994e80eb941a811a1aa8c/design)；更早已退出的方案和报告见 [首次清理前版本](https://github.com/nan023062/cbim/tree/c3178be11e24259d99ed59db60cc4781afb15782/design)。不再维护平行历史副本。
