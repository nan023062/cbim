---
id: adopt-orphan-design-doc
name: 将游离设计文档归位到根模块
purpose: 处置 design/ 目录下无 .dna 归属但被正典模块引用的 markdown 设计稿
triggers:
  - 游离文档
  - orphan design doc
  - design 目录
  - 文档归属
  - workflow 挂引用
related_skills: []
related_modules:
  - submodule/cbim/v1/kernel/engine/execution
  - submodule/cbim/v1/kernel/engine/dream
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
3. **整理客观判断卡片交决策者拍板**。不要让 agent 自己预测未来是否会被反复引用——那是主观判断。agent 只负责把以下客观事实整理成一张判断卡片，交给人类决策者拍板：
   - (a) 文档的 git 首次提交日期、最近一次修改日期、总修改次数（`git log --follow --format=%ad <文档>` 可拿到）；
   - (b) 当前正典模块正文中对该文档的引用次数与位置清单（步骤 1 已得到，直接复用）；
   - (c) 文档标题与首段自陈的定位（是「设计规范 / 蓝图」、「迁移记录 / 变更纪要」还是「决策备忘」——照抄原文，不做解释）；
   - (d) 文档正文里是否出现「已完成」、「已迁移」、「废弃」、「历史」、「on <日期>」等一次性字样，出现则列出所在行号。
   把这张四行卡片贴给人类决策者，由决策者拍板走「长期蓝图路径」（步骤 4）还是「一次性变更记录路径」（步骤 5）。agent 本身不做分叉判断。
4. **长期蓝图路径**：找到能同时覆盖所有引用方的最近公共祖先模块，用 `dna_edit(target="section", heading="Positioning", mode="append")` 在其 Positioning 下追加一段文档清单，为每份文档写一句「角色 → 文档路径」式的归属描述。归属描述必须能被 `dna_show` 该模块时看到。
5. **一次性变更记录路径**：将文档整体移动到归档目录（如 `archive/` 或版本化子目录），并从所有正典模块的正文中移除对该文档的引用，或将引用替换为对更权威模块的引用。归档文档不进入任何 `.dna/` 引用集。
6. **复核依赖**。确认被引用的模块（例如 `engine/execution`、`engine/dream`）没有因此需要新增 `dependencies` 字段——本流程处理的是知识引用，不新增模块间运行时依赖。

## 决策分支（Decision Points）

- **步骤 3 的分叉**：agent 不做分叉决策，只把客观判断卡片交给人类决策者；决策者拍板后再进入步骤 4 或步骤 5。分叉责任在人，不在 agent。
- **步骤 4 中「最近公共祖先」的选择**：若所有引用方都在同一子树下，选那个子树的根模块；若引用方跨子树，走「失败处理」里的多父升级路径，不在这里就地决策。

## 完成判定（Definition of Done）

每一条完成标准都必须能用 `grep` / `ls` / `test` 等命令直接验证通过与否——不接受主观描述。满足以下任一路径即视为完成：

- **长期蓝图路径**（三条 grep 硬标准全部通过）：
  - (a) `grep -Fc "<文档相对路径>" <归属模块路径>/.dna/module.md` 返回 `>= 1`（归属描述已写入该模块的 module.md）；
  - (b) `grep -F "<文档相对路径>" <归属模块路径>/.dna/module.md | grep -Fc "→"` 返回 `>= 1`（归属描述采用「角色 → 文档路径」箭头格式）；
  - (c) `grep -rF "<文档相对路径>" --include="module.md" --include="contract.md" .` 返回的所有匹配行，其文件路径要么就是 `<归属模块路径>/.dna/module.md`，要么在同一行内也包含 `<归属模块名>` 字样（即：其他模块若仍引用该文档，必须在同一行显式指向归属模块，不允许出现无归属说明的裸引用）。
- **一次性变更记录路径**（两条 grep/ls 硬标准全部通过）：
  - (a) `test -f <归档目录>/<文档文件名> && test ! -f <文档原相对路径>` 退出码为 `0`（文档已物理迁移到归档目录，原位置已消失）；
  - (b) `grep -rF "<文档原相对路径>" --include="module.md" --include="contract.md" .` 返回空、退出码为 `1`（无任何正典模块 `.dna` 内容仍在引用它）。

## 失败处理（Failure Handling）

- **多父冲突**：若步骤 1 发现该文档被两个或以上彼此无共同父模块的正典模块各自引用（分布在不同子树），**不要**强行选定其中一个模块作为归属——这会制造错误的所属关系并污染那个模块的 Positioning。此时应停下来，升级给用户决策，可选路径包括：(a) 提升到更高层级的父模块（可能需要新建一个覆盖两个子树的父模块）；(b) 将该文档拆分为多份、按引用方分别归位；(c) 判断该文档实际上是跨模块的原则性文件，应以另一种方式（例如根级 `docs/`）呈现，不进 `.dna` 引用集。
- **引用性质模糊**：若步骤 2 无法明确判定是知识引用还是运行时依赖，停下并升级——不要用本 workflow 处理不确定的对象。
- **判断卡片信息不足**：若步骤 3 中四类客观事实（git 时间、引用清单、自陈定位、一次性字样）任一无法取得（例如文档不在 git 版本控制下、首段无自陈定位），停下并升级——不要凭残缺卡片让决策者做判断。
- **归属描述写入后 `dna_show` 读不到**：说明写入位置未落在标准 Positioning 段落（可能被追加到了错误的 heading 下），回退到步骤 4 用 `dna_edit(target="section")` 精确指定 heading 后重试。

## 相关知识（References）

- `submodule/cbim/design/WORKFLOW-EXECUTION.zh-CN.md` 等 6 份位于 `submodule/cbim/design/` 下的游离设计文档，是本 workflow 首次落地时要处置的具体对象。
- 引用这些文档的两个正典模块：`submodule/cbim/v1/kernel/engine/execution`、`submodule/cbim/v1/kernel/engine/dream`。
- 归属描述的写入方式对应 `dna_edit(target="section")` 的 `append` 模式，见 `architect.arch_modules` skill 中「Update Module」段落。
- 本 workflow 首次落地时会验证「结晶四条门槛」——待验证前 status 保持 `spec`，通过后才可置为 `active`。
