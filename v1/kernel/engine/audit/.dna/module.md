---
name: audit
owner: architect
description: 架构漂移只读审计器：六项检查 + 棘轮基线，扫 .dna / agent / memory / 代码时间戳，不写盘
keywords:
  - audit
  - drift
  - baseline
  - checks
  - ratchet
  - read-only
status: implemented
body_edited_at: 2026-07-14T09:54:56Z
dependencies:
  - kernel/services
  - kernel/cbi/_primitives
  - kernel/memory
---

## Positioning

Read-only governance drift guard. Inspects the project's `.cbim/index.md`, every registered `.dna/module.md`, every project-level agent under `.claude/agents/`, and the memory service's published `stats()` output. Returns structured findings; never mutates anything.

Six checks, single dispatch surface:

- `index_consistency` — registry vs. on-disk module list
- `memory_threshold` — pulls metrics from `kernel/memory`'s `stats()` only; flags when short-tier count / staleness / candidate backlog cross the configured bands. **Does not own the thresholds' meaning, does not judge promotion-worthiness, does not read raw memory files.**
- `agent_fission` — project agent body & skill count oversize
- `dna_fission` — module body & workflow count oversize
- `dna_tree` — parent/child orphans, dep DAG (cycles, dangling, up-tree direction)
- `dna_freshness` — module.md `body_edited_at` (kernel auto-stamped on every module.md write) vs the latest git commit under the module directory (excluding `.dna/` and registered child modules); flags docs that haven't been re-touched since newer code landed. 7-day baseline; git-only (silently skips non-git projects).

Lives **inside** the engine package because every check threads through `engine.config` (audit thresholds live in `.cbim/config.json`'s `audit` section) and because the CLI surface (`cbim audit ...`) is one more sub-domain of `python -m engine`.

## Class Diagram

```mermaid
classDiagram
    class AuditFinding {
        <<dataclass>>
        +str check
        +str severity
        +str target
        +str message
        +dict metadata
        +str suggestion
        +str code
        +str origin
    }
    class AuditResult {
        <<dataclass>>
        +list~AuditFinding~ findings
        +dict summary
        +str ran_at
        +str project_root
        +dict config_snapshot
        +to_dict() dict
    }
    class run_audit {
        <<function>>
        +run_audit(project_root, checks, config, min_severity, baseline_mode) AuditResult
    }
    class list_checks {
        <<function>>
        +list_checks() list~str~
    }
    class CHECKS {
        <<registry dict>>
        +index_consistency : callable
        +memory_threshold : callable
        +agent_fission : callable
        +dna_fission : callable
        +dna_tree : callable
        +dna_freshness : callable
    }
    class load_audit_config {
        <<function>>
        +load_audit_config(project_root) dict
    }
    class resolve_bands {
        <<function>>
        +resolve_bands(threshold) tuple
    }
    class BaselineStore {
        <<facade>>
        +load() dict
        +accept(findings) None
        +clear(checks) None
        +list() list
        +fingerprint(finding) str
    }
    class register_audit_subparser {
        <<function · cli>>
        +register_audit_subparser(subparsers) None
    }
    class dispatch {
        <<function · cli>>
        +dispatch(args, project_root) int
    }

    run_audit ..> CHECKS : iterates selected checks
    run_audit ..> AuditResult : returns
    run_audit ..> AuditFinding : aggregates
    run_audit ..> load_audit_config : merges thresholds
    run_audit ..> BaselineStore : loads baseline, marks origin
    CHECKS ..> resolve_bands : per-check uses bands
    dispatch ..> run_audit : delegates
    dispatch ..> BaselineStore : baseline accept/clear/list
    register_audit_subparser ..> dispatch : wires argparse
```

## Key Decisions

- **Read-only by construction.** No check writes to `.dna/`, `.claude/agents/`, `.cbim/memory/`, or `.cbim/index.md` — even the registry it audits. Mutation belongs to dedicated commands (`cbim dna reindex`, `cbim memory cleanup`, `cbim agent ...`). Audit reports drift; it does not heal it.
- **Embedded inside `engine/`, not a sibling package.** The CLI surface is a sub-domain of `cbim ...` and config thresholds live in `.cbim/config.json`; making audit a sibling of `engine` would require an extra cross-package import dance for no real boundary win. Reversible later if audit grows non-CLI consumers.
- **Three-band severity (info / warn / error) via `resolve_bands`.** `info` = 80% of threshold (early-warning), `warn` = at threshold, `error` = 150% of threshold. Single helper used by every quantitative check; no per-check threshold logic drift.
- **Hardcoded `DEFAULTS` are pure fallback.** `load_audit_config` deep-merges `.cbim/config.json`'s `audit` section over `DEFAULTS`; audit itself never writes the merged result back. Users can override thresholds; the defaults stay readable in source.
- **Skill counting is a heuristic, isolated.** `_agent_skill_parser.count_skills` does fragile markdown-table parsing plus a `cbim skill show <agent>.X` regex fallback. Lives in its own module so a future structured skill metadata can drop the heuristic without touching the check.
- **Memory threshold check is a thin metrics consumer, not a judge.** `memory_threshold` pulls numbers from `kernel/memory`'s `stats()` interface and applies the audit-side band thresholds — that's it. It does **not** read raw entries under `.cbim/memory/`, does **not** decide what "should be promoted" to agent skills or `.dna/`, and does **not** emit per-tier promotion findings. v3 memory design (G5) reserves promotion-candidate identification for `kernel/memory/compaction/`; promotion candidates surface via `scan(filter="promote_candidate")` on the architect's own knowledge loop, not via audit. Audit only flags "candidate backlog crossed the band" as a quantitative drift signal.
- **Exit code follows max severity of the (filtered) findings.** 0 = clean / info, 1 = warn, 2 = error. `--severity X` filters display AND affects the exit code; that way CI can gate on `cbim audit run --severity error`.

- **`dependencies` frontmatter 语义**：仅声明跨边界、非祖先的依赖。同层兄弟、向下抽象层、外部模块都要列；任何祖先链上的模块一律不列。这一约定由 `dna_tree` 检查的 `TREE_DEP_ANCESTOR_DECLARED` 强制。

- **依赖拓扑：允许 vs 禁止**。`dependencies` 仅能列入 ① 同层兄弟（与本模块同父）、② 叔伯及其整棵子树（祖先节点的兄弟与那些兄弟下的全部后代）、③ 不在本模块祖先链上的任意外部模块。禁止列入 ① 任一祖先（含 `.` 项目根，祖先链上的可见性是隐式的）、② 自身子树下的任一后代（同样隐式可见，反向声明无意义）、③ 任何会形成环的目标。直观判别法：把本模块路径与候选路径并排写出、去掉公共前缀，两侧剩余都非空且首段不同（即「自己这一侧立刻分叉」）时才合法 —— 本侧剩余为空 ⇒ 候选是后代；候选侧剩余为空 ⇒ 候选是祖先。举例（本模块=`A/B/C`）：合法 `A/B/D`（兄弟）、`A/D`（叔伯）、`A/D/E`（叔伯子树后代）、`X/Y`（外部）；非法 `A`、`A/B`、`.`（祖先链）、`A/B/C/F`（自身后代）。强制方=`dna_tree`：祖先 → `TREE_DEP_ANCESTOR_DECLARED`；树上层但非祖先 → `TREE_DEP_UP_TREE`；不存在的路径 → `TREE_DEP_DANGLING`；环 → `TREE_CYCLE`(error)。

- **`dependencies` frontmatter 是类图边的派生缓存，不是声明源（T4 已实装）**。依赖关系的唯一声明源是**父模块** `## Class Diagram` 中**以本模块为出发点（src）的 `..>` 边**；frontmatter `dependencies` 是这些边的目标集的派生缓存，仅供审计 / 索引快速读取。两边不一致由 `dna_tree` 的 `TREE_DEP_DIAGRAM_MISMATCH` 强制（severity = **warn**，配合 baseline 棘轮：存量不一致进 baseline 不阻塞，新引入的不一致才拦）。写入纪律：先改父模块类图 `..>` 边、再让工具重生成本模块 frontmatter `dependencies`；不得手工编辑 frontmatter 而不动类图。

- **`TREE_DEP_DIAGRAM_MISMATCH` 解析规则（T4 实装契约）**。归口于 `dna_tree` 检查家族（与 `TREE_DEP_ANCESTOR_DECLARED` / `TREE_DEP_UP_TREE` / `TREE_DEP_DANGLING` / `TREE_CYCLE` 同模块），遍历每个**有父模块**的模块时执行：

  1. **父模块定位**：本模块路径去掉最后一段即父模块路径；查 registry 取父模块的 `module.md`。父路径不在 registry（孤儿）→ **跳过本模块的 mismatch 比对**（孤儿由 `TREE_ORPHAN` 报，不在本检查范围）。
  2. **类图块抽取**：在父模块 `module.md` body 中按围栏抽取所有 ```` ```mermaid ```` 代码块；对每个块识别首关键字（`classDiagram` / `flowchart` / `graph` 等），仅在 `classDiagram` 类图中解析 `..>` 边。其他 mermaid 块（`flowchart` / `graph`）不参与解析—— 它们是辅助拓扑图，不是依赖权威源。父模块完全没有 `classDiagram` 块 → **跳过本模块的 mismatch 比对**（视为父模块尚未迁移到规范类图，进 `TREE_PARENT_DIAGRAM_MISSING` 的 info 提醒由后续单独决策，但**当前 T4 不报**，避免一次性引爆所有历史模块）。
  3. **边方向语义**：从父模块所有 `classDiagram` 块中抽取形如 `<src> ..> <dst>` 的边（也接受 `<src> ..> <dst> : <label>`）。**以本模块为 `<src>`** 的边的目标集 = 「类图声明的本模块依赖集 D_diag」。
  4. **节点名 → 模块路径解析**：类图中的子模块节点名应等于该子模块的 frontmatter `name`（推荐做法）或子模块目录 basename（向后兼容）。两种皆按 registry 反查回模块路径；解析不到任何已注册模块路径的节点名 → 视为外部 / 占位节点，在本检查中**忽略该条边**（不报 mismatch，不报 dangling—— dangling 归 `TREE_DEP_DANGLING` 检查）。
  5. **frontmatter 依赖集 D_decl**：本模块 frontmatter `dependencies` 列表。
  6. **集合比对**：
     - `D_decl \ D_diag`（声明了但类图没画）→ 每项 1 条 finding，`code = TREE_DEP_DIAGRAM_MISMATCH`，`severity = warn`，`message` 形如 "frontmatter declares dependency on `<dep>` but parent module's class diagram has no `..>` edge from this module to it"。
     - `D_diag \ D_decl`（类图画了但 frontmatter 没声明）→ 每项 1 条 finding，同 code 同 severity，`message` 形如 "parent module's class diagram has a `..>` edge from this module to `<dep>` but frontmatter `dependencies` does not include it"。
     - 两集合相等 → 无 finding。
  7. **边界与异常优雅处理**（不准崩、不准误报）：
     - 模块无父（顶层模块如 `.` / `v1/kernel`）→ 跳过。
     - 父模块 `module.md` 读取失败 / 无 body → 跳过。
     - mermaid 块 fence 不闭合 / 类图语法错误 → 该块解析返回空边集，不抛异常；其他块照常处理。
     - 边的 `<src>` 或 `<dst>` 含 stereotype 标记（`<<module>>` / `<<dataclass>>` 等）、引号、空格 → 按已知容错策略 strip 后再解析。
     - 类图节点名空字符串、纯标点 → 视为解析失败，忽略该边。
     - 本模块 frontmatter `dependencies` 字段缺失或非列表 → 视为空集 `D_decl = []`，照常进集合比对（这样 "类图画了依赖、frontmatter 完全没声明" 的极端漂移仍能被抓到）。
  8. **代码归属**：实装在 `engine/audit/dna_tree.py`（与现有 `TREE_*` 检查同文件），新增私有辅助 `_parse_class_diagram_deps(parent_body) -> dict[node_name, set[target_module_path]]` 负责所有 mermaid 解析；该辅助纯函数、可独立单测。
  9. **测试覆盖（programmer 必须实现）**：
     - 一致：父类图 `Child ..> Sibling`，子 frontmatter `dependencies: [<sibling-path>]` → 无 finding。
     - 多一条：frontmatter 多出 `[A, B]`、类图只画 `..> A` → 报 1 条 mismatch（B 在声明而不在图）。
     - 少一条：frontmatter `[A]`、类图画 `..> A, ..> B` → 报 1 条 mismatch（B 在图而不在声明）。
     - 边界：模块无父 → 不报、不崩；父无 `classDiagram` 块（只有 flowchart）→ 不报、不崩；类图 fence 未闭合 → 不报、不崩；frontmatter `dependencies` 缺失 → 类图有边时仍能抓到。
     - 节点名经 stereotype / 引号包装（`class "engine/audit"`、`class core { <<module>> }`） → 正确解析回模块路径。
     - 类图节点名指向 registry 未知名 → 该边静默忽略，不报 mismatch。

- **棘轮交互**：`TREE_DEP_DIAGRAM_MISMATCH` 走 `dna_tree` 的现有 lenient 策略——`origin=baseline` 降一档（warn→info）、`origin=new` 维持 warn。配合默认 `baseline_mode` 只统计 `new`-origin findings 进 exit code，存量历史不一致进 baseline 后不阻塞 CI，新引入的不一致才会拉高 exit code。

- **已知首批 baseline 候选**：T4 上线后预计立即产出的 mismatch（属于已知存量、按计划 `cbim audit baseline accept --check dna_tree` 一次性吸收）：
  - `engine/audit` 自身：frontmatter `dependencies: [services, _primitives, memory]` 与父模块 `engine` 类图（当前为 `flowchart`，无 `classDiagram` 块）—— 父图迁移完成前实际跳过比对；父图迁移后会产出 mismatch 进 baseline。架构师 T2 已提醒。
  - 其他历史模块若父图为 `flowchart` 一律暂时跳过；待父图渐进迁移到 `classDiagram` 后逐批进入 baseline。

- **未来扩展（不在本轮 T4 范围）**：`TREE_PARENT_DIAGRAM_MISSING`（父模块完全无 `classDiagram` 块 → info 级提醒，推动父图迁移）、`TREE_DEP_DIAGRAM_FLOWCHART_FALLBACK`（父图同时有 flowchart 与 classDiagram、且两者依赖集不一致 → 提示删 flowchart）。新增码与决策同走 contract 变更流程。

- **`AuditFinding.origin ∈ {baseline, new}` —— 棘轮机制的根字段**。默认 `new`，向后兼容：老 JSON 缺该字段均视为 `new`。`origin` 是后续所有棘轮策略的唯一输入；除定义论外不允许出现第三个取值。
- **`BaselineStore` 是唯一门面**。原子读写（`tempfile` + `os.replace`）、指纹去重；指纹 = `hash(check + code + target + sha256(message))`。同模块同 finding 一旦 `message` 升级即视为新 finding（重新进入 `new`-origin）—— 避免 "改描述就隐形降级" 的破窗。任何其他模块读 / 写 baseline 都必须走该门面，不得直接触及 `.cbim/audit/baseline.json`。
- **棘轮降级表—— `baseline`-origin 降一档（`error→warn→info`），`new`-origin 永不降级**。源代码读下表，不硬编码任何 check 名：

  | check | 策略 |
  |---|---|
  | `dna_tree` | lenient |
  | `dna_fission` | lenient |
  | `agent_fission` | lenient |
  | `index_consistency` | strict |
  | `memory_threshold` | strict |

  `strict` = 不降级（即使 `origin=baseline`）；`lenient` = 按上文规则降一档。
- **Exit code 默认仅统计 `new`-origin findings**。默认模式下，baseline 里已接受的项不拉高最终 exit code；CI 质量门锁只看"本次新增"。`--baseline-mode=ignore` 时回退全量统计（供一次性全面检查使用）。
- **Audit 进程仍 read-only；baseline 写入仅能走显式 CLI 子命令**。`cbim audit baseline accept` 必须携 `--yes`；`run_audit` 与治理循环（`dream_tick`）绝不自动写 baseline。"接受棘轮退一格" 是人类动作，不是可推导事件。
- **`BaselineStore` 是 audit 的第 9 个节点**，进入 Class Diagram；`run_audit ..> BaselineStore`（读取时加载、为 finding 打 `origin` 标）。CLI `baseline accept/clear/list` 同样仅通过 `BaselineStore` 写入。

- **Batch 5 异常治理 —— `BaselineStore.save` 原子写收紧到 `OSError`。** `tempfile` + `os.replace` 写 `.cbim/audit/baseline.json` 的 cleanup 分支已从 broad-catch 收紧到 `except OSError`：原子写失败的可能性集合是 IO/权限/磁盘满，全在 `OSError` 下；其他异常（编程错误、序列化 bug）应当裸抛而非被 cleanup 吞掉。配合 "audit 进程仍 read-only；baseline 写入仅能走显式 CLI 子命令" 的既有铁律——baseline.json 是 CI 质量门锁的状态来源，写盘失败必须可见、不可静默。完整规约见 `v1/docs/EXCEPTION-GOVERNANCE.zh-CN.md`。

- **`dna_tree` 统一父模块判定 + `TREE_NAME_COLLISION` 显式化**。`dna_tree` 内所有"本模块的父模块是谁"计算统一走 `_find_parent(path, all_paths)` —— 最近已注册祖先。既往孤儿检测走 `_find_parent`、依赖边解析走文件系统直接父目录（`path.rsplit("/", 1)[0]`）的两个不一致定义，会在"中间目录未注册"的场景下让依赖边被吞掉、`TREE_CYCLE` / `TREE_DEP_DANGLING` 漏报。统一后两处判定同源。配套修 `name_to_path` 构建：遇到 frontmatter `name` 重名不再静默丢弃，产出 `TREE_NAME_COLLISION`（severity=warn，lenient 降级策略，origin=new）—— 保留"第一个注册的胜出"策略避免破坏历史 findings 的 target 稳定性，但让重名从"隐形错解析"变成"显式可见 finding"；遍历改用 `sorted(by_path.items())` 保证冲突时"哪个模块赢"是确定的、跨机器可复现的。

- **`dna_freshness` —— 文档 vs 代码时间轴对齐嫀疑信号（7 天基线）。** 消费 `.dna/module.md` frontmatter 中由 kernel 自动维护的 `body_edited_at` 字段（每次 module.md 写入时由 `cbi/_primitives/modules/doc_writer.py` 打时间戳），与“模块目录下（排除 `.dna/` 与已注册子模块目录）最新 git commit 时间”对比，差值超阀值即报 `DNA_FRESHNESS_STALE`。约束：
  - **阀值 7 天，`resolve_bands(7)` 分三段：info=6、warn=7、error=11 天**（标准 80% / 100% / 150% 比例的取整结果）。阀值走 `.cbim/config.json` 的 `audit.dna_freshness.stale_days` 字段，默认 7。
  - **棘轮策略 lenient**，与 `dna_tree` / `dna_fission` / `agent_fission` 一致——`origin=baseline` 降一档（error→warn→info），`origin=new` 不降。`ratchet.py` 的策略表已同步新增这一行（上方 Key Decision 里的参考表没同步，源代码 `ratchet.py` 为单一真相源）。
  - **降级路径**：非 git 项目 / git 二进制不在 PATH / 模块目录不在 git 追踪内 / 模块目录下无追踪文件 / module.md 缺 `body_edited_at` 字段（存量未迁移） → 该模块跳过不产 finding，不报 error。存量迁移已一次性跑过 `cbim dna stamp-freshness` 补齐内核自己 20 个模块的 `body_edited_at`。
  - **`message` 必须保持固定文案，可变量（天数 / 时间戳）一律入 `metadata`——硬性约束。** `BaselineStore` 指纹 = `hash(check + code + target + sha256(message))`；若 message 含“距上次编辑 X 天”「上次编辑于 <日期>”这类会变字符串，每次 audit 都会为同一模块产新指纹→全部落 origin=new→baseline 机制彻底失效→CI 永远不绿。7 天基线下触发频率高，这条约束尤为关键。实现定义：`code=DNA_FRESHNESS_STALE`，`message` 冃 "module `<path>` body edited before newer code commits landed in this module directory" 一句，`metadata` 承载 `body_edited_at` / `latest_code_commit_at` / `days_stale` 三个观测量。指纹稳定性已由单测硬销（同一场景连续跑 3 次 fingerprint 字节相等）。
  - **本检查是“嫀疑信号”不是“漂移证据”**——代码新提交但文档未变未必意味着文档陈旧（注释 / 内部实现微调等场景文档不受影响）。架构师看到 finding 后自行判定——真漂移就改 module.md（kernel 会自动重刷 `body_edited_at`），伪阳性就 `cbim audit baseline accept --check dna_freshness --yes` 吸收存量。与 `TREE_DEP_DIAGRAM_MISMATCH` 同模式：audit 只发信号，修复动作仍是人的责任。

- **`skill_scripts` —— HR Skill CRUD 扩展新增的定期安全 review 检查项（2026-07-14 决策锁定）**。依附于 cbi/agents 新增的 skill 目录形 + assets/ 护栏体系；属于需要人类读目录、不是自动修复的“疑似信号”——与 `dna_freshness` 同模式。

  **扫描范围**：`.claude/agents/<name>/skills/<skill>/assets/**`，只看 `<name>` 不在 `{"architect","auditor","hr","programmer"}` 集合内的 work agent。内置四 agent 的内核版 skill 目录（`cbi/agents/<name>/skills/<skill>/skill.py` + 可能伴随的任何文件）不在扫描范围内（内核版本管理，CI 的安全评审已有单独机制）。

  **数据源**：`services.list_agents(include_builtin=False)` + 直接扫磁盘（`.claude/agents/<name>/skills/*/assets/`）。无需额外跨包依赖；不读 `.cbim/`。

  **Finding codes**（均入 `SKILL_SCRIPT_*` 命名空间）：

  | code | severity | 触发条件 |
  |---|---|---|
  | `SKILL_SCRIPT_UNTRACKED_EXTENSION` | warn | assets/ 下发现后缀 ∈ executable 白名单但没有 sibling `.executable-declared` 标志文件（方案：服务层写 is_executable=True 时额外写 `<asset>.executable-declared` 零字节标志，供审计进行“可执行声明与磁盘后缀对齐”岚验）|
  | `SKILL_SCRIPT_SIZE` | info ≥ 200KB · warn ≥ 500KB · error ≥ 1MB | 单个资产体积过大（bin/exe/dll 很大概率反者“恶意或遇具”）|
  | `SKILL_SCRIPT_OUTSIDE_ASSETS` | error | 直接发现 `<skill>/*.<exec-ext>` 不在 assets/ 下（写入层报比壹盖）|
  | `SKILL_SCRIPT_CORE_AGENT_VIOLATION` | error | 内置四 agent 目录下发现由 HR CRUD 途径写入的 assets（自保护岚验：服务层已拒内置四名，本项拓思比壹盖）|

  **棐轮策略**：新 check 写进 `_CHECK_MODE`，lenient——递推 baseline 适应存量；oirin=new 保持原严重度。severity 写入使用 `resolve_bands(200_000)` 与预设阈值一致。

  **错误消息不变铁律（与 dna_freshness 一致）**。messsage 中不得包含体积数、mtime；可变量均入 metadata ——保持基线指纹稳定。

  **实物预名**：`engine/audit/checks/skill_scripts.py`。新增的尔后注入 `audit/registry.py::CHECKS`；`ratchet._CHECK_MODE` 多一行 `"skill_scripts": "lenient"`。`.cbim/config.json` 可选配置 `audit.skill_scripts.size_bytes` 默认 200000；无需其他参数。

## Non-Goals

- **No auto-fix.** Audit reports drift; it never rewrites `.dna/`, `.claude/agents/`, or `.cbim/memory/`. Fix commands stay in their owning modules.
- **No writes to `.dna/` from inside any check.** This includes the registry: even though `index_consistency` knows when `.cbim/index.md` is stale, it only emits a finding pointing at `cbim dna reindex`.
- **No semantic judgment.** Audit does not decide whether a memory entry "should be promoted" to agent skills or `.dna/`. Promotion-candidate identification belongs to `kernel/memory/compaction/`; the architect's knowledge loop consumes those candidates via `scan(filter="promote_candidate")`. Same for fission: audit reports oversize, it does not propose how to split.
- **No raw reads under `.cbim/memory/`.** `memory_threshold` reaches memory **only** through `kernel/memory`'s `stats()` interface. Direct file walks under `.cbim/memory/short/` / `medium/` / `candidates/` are forbidden — that would couple audit to memory's internal layout and re-introduce the threshold-judgment leak this collapse was meant to fix.
- **No deep semantic import scan.** Dependency direction comes from `frontmatter.dependencies`. We do not parse Python imports, grep code references, or trace call graphs — that is a separate concern with very different cost/precision trade-offs.

- **审计本身永不写 `.cbim/audit/baseline.json`**。`run_audit` 只读 baseline、为 finding 打 `origin` 标；写入仅通过显式人类命令（`cbim audit baseline accept --yes` 等）走 `BaselineStore`。治理循环 / CI / 引擎任何路径都不得隐式写入—— 防“深夜静默接受”破窗。

