---
id: adopt-orphan-design-doc
name: 将游离设计文档归位到根模块
purpose: 处置 design/ 目录下无 .dna 归属但被正典模块引用的 markdown 设计稿
triggers: [游离文档, orphan design doc, design 目录, 文档归属, workflow 挂引用]
related_skills: []
related_modules: [submodule/cbim/v1/kernel/engine/execution, submodule/cbim/v1/kernel/engine/dream]
owner: architect
status: spec
---

## 前置条件（Preconditions）

- 存在一份 markdown 设计稿，物理位置在 `design/` 或类似非 `.dna/` 目录下。
- 该文档不带 `.dna/module.md` 归属，无 CBIM frontmatter，未出现在任何模块的 `index.md` 中。
- 至少有一个已注册的正典模块的 `module.md` 正文里以相对路径引用了它。
- 引用是知识引用（供人阅读、追溯背景），而非运行时依赖（不出现在代码 import / 契约调用链中）。

## 步骤序列（Steps）

1. **枚举被引用点**。用 grep 或索引查询确认该文档当前被哪些模块的 `module.md` / `contract.md` 引用；把每个引用点记录成 `(引用方模块路径, 引用行, 引用语义)`。
2. **判定引用性质**。核对引用语义是「知识引用」还是「运行时依赖」——若正文形如"参考 xxx.md 的原始设计"属知识引用；若代码文件依赖该文档中定义的协议 / schema 则属运行时依赖。运行时依赖需按依赖变更流程另行处理，本 workflow 只处理知识引用。
3. **判定文档定位**。判断该文档是**长期蓝图**（持续被后续设计反复援引的原始设计说明）还是**一次性变更记录**（描述某次已完成的迁移、重构、决策落地）。
4. **长期蓝图路径**：找到能同时覆盖所有引用方的最近公共祖先模块，用 `dna_edit(target="section", heading="Positioning", mode="append")` 在其 Positioning 下追加一段文档清单，为每份文档写一句「角色 → 文档路径」式的归属描述。归属描述必须能被 `dna_show` 该模块时看到。
5. **一次性变更记录路径**：将文档整体移动到归档目录（如 `archive/` 或版本化子目录），并从所有正典模块的正文中移除对该文档的引用，或将引用替换为对更权威模块的引用。归档文档不进入任何 `.dna/` 引用集。
6. **复核依赖**。确认被引用的模块（例如 `engine/execution`、`engine/dream`）没有因此需要新增 `dependencies` 字段——本流程处理的是知识引用，不新增模块间运行时依赖。

## 决策分支（Decision Points）

- **步骤 3 的分叉**：文档是长期蓝图 → 走步骤 4；文档是一次性变更记录 → 走步骤 5。分叉判据是「后续设计是否会反复引用它」，一次性判断，不回退。
- **步骤 4 中「最近公共祖先」的选择**：若所有引用方都在同一子树下，选那个子树的根模块；若引用方跨子树，走「失败处理」里的多父升级路径，不在这里就地决策。

## 完成判定（Definition of Done）

满足以下任一即视为完成：

- **长期蓝图路径**：该文档在某个已注册模块的 Positioning 段落里获得一句明确的归属描述（角色 + 相对路径），且执行 `dna_show <该模块路径>` 时能在输出中读到这句话；同时该文档在其他所有正典模块正文中的引用要么保留（附带指向归属模块的说明），要么替换为对归属模块的引用。
- **一次性变更记录路径**：文档已物理移动到归档目录（`archive/` 或等价路径），且执行全仓 grep 确认已无任何正典模块的 `.dna` 内容引用它。

## 失败处理（Failure Handling）

- **多父冲突**：若步骤 1 发现该文档被两个或以上彼此无共同父模块的正典模块各自引用（分布在不同子树），**不要**强行选定其中一个模块作为归属——这会制造错误的所属关系并污染那个模块的 Positioning。此时应停下来，升级给用户决策，可选路径包括：(a) 提升到更高层级的父模块（可能需要新建一个覆盖两个子树的父模块）；(b) 将该文档拆分为多份、按引用方分别归位；(c) 判断该文档实际上是跨模块的原则性文件，应以另一种方式（例如根级 `docs/`）呈现，不进 `.dna` 引用集。
- **引用性质模糊**：若步骤 2 无法明确判定是知识引用还是运行时依赖，停下并升级——不要用本 workflow 处理不确定的对象。
- **归属描述写入后 `dna_show` 读不到**：说明写入位置未落在标准 Positioning 段落（可能被追加到了错误的 heading 下），回退到步骤 4 用 `dna_edit(target="section")` 精确指定 heading 后重试。

## 相关知识（References）

- `submodule/cbim/design/WORKFLOW-EXECUTION.zh-CN.md` 等 6 份位于 `submodule/cbim/design/` 下的游离设计文档，是本 workflow 首次落地时要处置的具体对象。
- 引用这些文档的两个正典模块：`submodule/cbim/v1/kernel/engine/execution`、`submodule/cbim/v1/kernel/engine/dream`。
- 归属描述的写入方式对应 `dna_edit(target="section")` 的 `append` 模式，见 `architect.arch_modules` skill 中「Update Module」段落。
- 本 workflow 首次落地时会验证「结晶四条门槛」——待验证前 status 保持 `spec`，通过后才可置为 `active`。
