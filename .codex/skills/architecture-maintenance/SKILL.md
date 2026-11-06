---
name: architecture-maintenance
description: "维护 CBIM 的源码架构、单向依赖、代码注释和目录类图。修改 src/ 代码、移动或拆分模块、新增接口、检查循环依赖或更新架构文档时使用。"
---

# CBIM 架构维护

将代码变更、注释和类图作为同一个交付。先读仓库根目录 `AGENTS.md`；其注释和类图要求只适用于 `src/`，不要扩大到 tests、scripts、docs 或本 Skill。

## 1. 确认真实结构

- 先运行 `git status --short`、查看相关 diff，保留已有未提交工作。
- 阅读 `docs/source-layout.md`、`src/ARCHITECTURE.md` 和涉及目录的架构文档，再读实际源码、调用方与测试。代码优先于文档。
- 批量重构或生成全部类图前，完整分析 src 的入口、数据流、职责边界及依赖，再决定目录结构；禁止先按旧目录机械生成文档。
- 先运行 `pnpm check:dependencies` 建立基线；把每个文件作为模块，类型引用也算依赖。

## 2. 保持单向依赖

当前允许方向以 `scripts/check-dependencies.mjs` 的 layers 和源码为准：

- backend/core → backend/core。
- backend/scheduler-engine → 自身、backend/core。
- backend/main → 自身、backend/scheduler-engine、backend/core、bridge/contracts。
- bridge/contracts → 自身、backend/core 的公开契约和纯函数。
- frontend → 自身、bridge/contracts。
- bridge/preload → 自身、bridge/contracts。
- frontend 是视图层，backend 是本机后端逻辑层；bridge 是通信边界。禁止前端直接导入后端实现，也禁止后端导入前端。

遇到循环时，先确认职责归属；把双方需要的协议抽到独立契约模块，或用端口注入实现。不要仅改成 `import type`、动态加载或 re-export 隐藏循环。契约不得再引用实现类，否则循环仍然存在。不要为了消环把不相关职责堆到公共文件。

变更路径时同步导入、构建入口、测试引用和文档导航。不要引入空目录、占位实现，或把计划能力描述为已交付。

## 3. 同步注释与类图

- src 脚本顶部说明作用定位、设计原因及必要的边界；关键接口补充生命周期、权限、事务、并发、失败或释放语义。关键字段说明身份、单位、所有权和空值含义。
- 每个受影响目录维护 `ARCHITECTURE.md`。叶子目录展示全部代码类图；非叶子目录展示本层代码与直接子目录的真实关系。不要将目录画成实际类，也不要虚构继承。
- 若新增目录，先人工确定其职责并维护 `scripts/source-architecture.mjs` 中的目录定位，再执行 `node scripts/source-architecture.mjs`。
- 检查生成后的 diff、代码清单、关键成员、连线方向和链接。生成器不能替代架构分析；只改行为而未改依赖时，同步相关职责说明，不制造无意义关系。

## 4. 验证后再报告

按顺序运行：

```sh
pnpm typecheck
pnpm check:architecture
pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts
```

再运行与变更相关的行为测试。广泛重构应运行 `pnpm test`；涉及打包入口或原生模块时补真实打包验证。不要将未运行的检查标为通过。

循环检测范围为 src、tests、scripts、design、docs、.claude、.codex 的 JS/TS 文件及仓库根 JS/TS 配置，包含声明文件、类型 import/export、import type 表达式、动态字面量 import、require 与 createRequire 常见本地别名。根目录新增其他代码树时，必须扩展检测器 roots，避免漏检。

构建产物、依赖、缓存不属于维护代码。无法解析的本地引用、指向扫描范围外的源码、未审核的计算式加载和层级越界均失败。第三方非字面量加载只能在核实目标后按“文件 + 精确表达式 + 理由”登记；禁止为项目内部循环加豁免。静态分析不保证任意运行时元编程或反射的实际依赖，此类代码必须人工审查。

修改检测器时，用系统临时目录创建测试样例，至少验证类型环、长环、自引用和正常无环图；不要把有意成环的样例放入仓库被检测目录。

最终说明列出：改动的依赖边界、已执行验证、同步维护的注释与架构文档，以及剩余限制。没有完成同步维护，不得报告完成。

## 多宿主同步

本流程同时存放在 .claude/skills/architecture-maintenance/SKILL.md 和 .codex/skills/architecture-maintenance/SKILL.md。修改任一份时同步另一份，保持内容一致。
