# CBIM 记忆系统重构蓝图(设计提案)

> 状态:设计提案,**未实装**。
> 范围:`v1/kernel/memory/`、`v1/kernel/engine/retrieval/`、`v1/kernel/engine/execution/`、`v1/kernel/engine/dream/`、`v1/kernel/project/hooks_src/`、`v1/.dna/`。
> 不在范围:Nan-Li 宿主的 `.cbim/`、`.cbim/kernel/` 写入。
> 落地原则:每阶段独立可交付,完成后再随代码更新对应 `.dna/module.md`。本文不写进任何 module.md 的 Key Decisions。

---

## 一、结论先行(三条主线)

1. **统一记忆观**:把"知识"和"记忆"看成同一存储族系的不同稳定层。
   - **永久记忆 = 能力知识(`.claude/agents/`)+ 业务知识图谱(`.dna/`)**——规则/法律级,稳定权威,变更走治理通道。
   - **可变记忆 = `.cbim/memory/medium/` + `candidates/`**——会话/事实/操作痕迹,append-only,定期蒸馏/晋升/清理。
   - 两者**用同一套检索基础设施**(`engine.retrieval` 的 4 个 source:`dna` / `agents` / `memory_medium` / `transcript`),不另起灶。

2. **现状最大硬伤已勘出**:`bb.retrieved_context` 是有的(`actions/context_retrieval.py` 在 BT 每个 tick 拉 4 源),但**只有架构师 prompt 渲染了它**(`arch_exec_yield._render_module_knowledge` 只读 `module_knowledge` 桶)。Work Agent 的 prompt(`dispatch_work._compose_prompt`)、三大核心 agent 的 prompt(`dispatch_core_agent`)、conversation 模式(`direct_reply`)**全都没拼 retrieved_context**。所以"召回只喂架构师"这个病用代码可证。
   - 这意味着:用户问 work agent / hr / auditor / 闲聊时,记忆和知识对它们都是黑的。这是 v2 召回管线的最大语义漏。

3. **重构落地手段(主人指定)= hook 驱动 + 主上下文注入**:
   - 召回从 BT 内一节(`ContextRetrieval`)外移到 hook(`SessionStart` 已有先例,`UserPromptSubmit` 加注入即可)。CC 的 `additionalContext` 是主上下文级别注入,**所有模式、所有 sub-agent dispatch 都看得到**——一举堵召回死角。
   - 廉价捕获(信号词、agent receipt 总结)走 `Stop` / `SubagentStop`(`SubagentStop` 标 `[CC-API 待核]`),只 append,不做判断。
   - 重活(蒸馏、晋升、压缩、值不值得记)集中到 `dream` 循环——已经有 `MemPromoteScan`、`MemCompact`、`DispatchMemDistill` 的骨架,在它上面接通即可。

---

## 二、统一记忆架构图

```
┌─────────────────────── 永久记忆 ───────────────────────┐
│  ① 能力知识(agent 认知记忆)                          │
│     .claude/agents/<name>/<name>.md  + skill .md       │
│     索引 source = "agents"                             │
│  ② 业务知识图谱(.dna)                                │
│     .dna/module.md (frontmatter + 类图)                │
│     .dna/contract.md(可选)                            │
│     .cbim/index/dna/(物化)                            │
│     索引 source = "dna" + 邻接表 graph.json(新增)      │
└────────────────────────────────────────────────────────┘
                    ▲                  ▲
            治理通道 │                  │ 召回(读)
       (architect / │                  │
        hr / 主人)  │                  │
                    │                  │
┌────────────── 可变记忆(会话→事实)──────────────────┐
│  ③ medium 条目                                          │
│     .cbim/memory/medium/<date>-<slug>.md                │
│     索引 source = "memory_medium"                       │
│  ④ 候选区(promote 工作区)                              │
│     .cbim/memory/candidates/*.candidate.json            │
│     不入索引 — 是 dream 的 staging 队列                 │
│  ⑤ transcript(原始痕迹)                                │
│     ~/.claude/projects/<slug>/*.jsonl                   │
│     索引 source = "transcript"                          │
└─────────────────────────────────────────────────────────┘

           ┌─── 三个处理时机 ───┐
           │                    │
   召回(读) │  (确定性、廉价)  │ 捕获(写)
           │                    │
       SessionStart hook     Stop / SubagentStop hook [CC-API 待核]
       UserPromptSubmit hook
           │                    │
           └────── 治理 ────────┘
                    │
              dream loop(LLM)
              (蒸馏 / 晋升 / 压缩)
```

---

## 三、hook / BT / dream 最终分工表

| 时机 | 现状 | 重构后职责 | 手段 | 确定性边界 |
|---|---|---|---|---|
| `SessionStart` hook | 跑 4 源索引 sync + dream banner + project snapshot 注入 `additionalContext` | **不变,补"召回首轮"**:用 cwd 启动目录上次会话末问句作为种子,注入近期 medium + 相关 .dna 摘要 | `engine.retrieval.search` × 4 源,RRF 融合;走现成的 `additionalContext` 通道 | 失败永不阻塞启动(已实现 safe_run) |
| `UserPromptSubmit` hook | 只 mark_busy + log_user | **新增主上下文召回注入**(注入受众=coordinator 主上下文;子 agent 不自动继承,其 prompt 级召回仍由 BT `ContextRetrieval` 承担) | 同 SessionStart 一套召回(query=用户原文),用 `additionalContext` 把 4 桶塞主上下文 | 失败回退空 ctx,不阻塞 prompt 提交 |
| `Stop` hook | 标记 idle + 索引整段 transcript 到 `transcript` source | **不变**(已经是廉价捕获的一种)。可考虑顺手扫信号词 → append candidates(可选优化) | 现成 `index_upsert` | 已实现 |
| `SubagentStop` hook | **不存在** [CC-API 待核:CC 是否有 SubagentStop 事件 + transcript_path] | **新增**:读 sub-agent 输出,识别 `CBIM-RECEIPT` trailer,把 receipt summary append 到 medium 候选区(只 append,不判断价值) | 新 hook,复用 `bridge.bootstrap_kernel` 范式 | 信号词级廉价规则;无 LLM |
| BT `ContextRetrieval` 节点 | 每 tick 拉 4 源写 `bb.retrieved_context`,只有 architect prompt 用了 | **阶段 1 保留**(为架构师 `module_knowledge` 服务);后续阶段消解双召回 | — | 受众边界:hook 注入服务 coordinator 主上下文,BT 节点服务架构师 prompt;两路并存到双召回收敛为止 |
| BT `dispatch_work / dispatch_core_agent / direct_reply` | prompt 不拼 retrieved_context | **不需要改**——hook 注入是主上下文,所有 dispatch 自动继承 | — | 关键收益:零侵入 dispatch 节点 |
| dream `MemPromoteScan` | feature flag off,空跑 | **接通**:消费 `promote_builder.scan_for_promote_candidates` 的产出,把 medium 候选交给 architect 在 `ArchitectGovernanceStep` 评审晋升 .dna | 现有 Sequence 已布好位 | flag on 后开始产出,治理消费 |
| dream `DispatchMemDistill` | 已实现(yields 给 main agent 跑 memory_distill) | **不变**——重活归宿正确 | 已实现 | — |
| dream `MemCompact` / `MemSweepExpired` | 已实现 | **不变** | — | — |
| dream(新增)`KnowledgeCompact` 步 | 不存在 | **新增(阶段 5)**:在 ArchitectGovernanceStep 内插一个 leaf,周期触发"永久知识自身压缩"(扫描 .dna 树 → 找冗余/过时模块 → 写 advice_pending) | 复用现有架构师治理回路 | 只产 advice,不直接改 .dna |

---

## 四、业务知识图谱(.dna 关系层)方案

### 4.1 现状能复用什么

- 已有:`engine.retrieval` 的 `dna` source(BM25 + 向量),按文档级别召回 module.md 全文。
- 已有:每个 module.md 的 frontmatter `dependencies: [...]`(模块自报依赖)。
- 已有:每个 module.md body 的 mermaid `classDiagram`,父模块用 `..>` 表示子模块依赖,叶模块用代码级类。
- 已有:`index.md`(根模块维护)给出全树父子边。

### 4.2 关系层做法(零外部依赖)

新增物化文件 `.cbim/index/dna/graph.json`(由 dream 周期重建,session_start sync 增量补丁):

```json
{
  "schema_version": 1,
  "nodes": {
    "<module_path>": {
      "name": "...",
      "owner": "...",
      "kind": "root|parent|leaf",
      "status": "spec|planned|implemented",
      "keywords": [...]
    }
  },
  "edges": [
    {"from": "<a>", "to": "<b>", "kind": "depends_on", "origin": "frontmatter"},
    {"from": "<a>", "to": "<b>", "kind": "depends_on", "origin": "classdiagram"},
    {"from": "<parent>", "to": "<child>", "kind": "contains", "origin": "index_md"}
  ]
}
```

**边来源**(全部从已有素材抽取,无新数据):
- `depends_on / frontmatter`:扫 module.md frontmatter `dependencies` 字段。
- `depends_on / classdiagram`:解析 mermaid `classDiagram` 中的 `..>` / `-->` 箭头(只在 parent 类型 module.md 才识别——parent 节点是 `<<module>>`)。
- `contains`:从根 `index.md` 的 path 列表 + 路径前缀关系推导(`a/b` 是 `a` 的子)。

**物化时机**:
- `dream.MemRebuildIndex` 旁边新增 `DnaGraphRebuild` leaf,全量重建。
- `SessionStart hook` 的 `_sync_source_with_disk("dna", ...)` 顺手对触及到的模块做增量 patch(只更那几行)。

**查询接口**(新增 `engine.retrieval.graph` 子模块,leaf 级):
```python
def neighbors(module_path: str, *, kind: str | None = None, depth: int = 1) -> list[str]: ...
def subgraph(seeds: list[str], *, depth: int = 2) -> dict: ...
```

**召回融合**(关键):
- 现召回:`search("dna", query)` 返回 top-k 模块。
- 新召回:对 top-k 每个 hit 跑 `neighbors(hit.doc_id, depth=1)`,把邻域模块作为"扩展候选"召回出来(不进 RRF,单独成一桶 `dna_neighborhood`)。
- 给 architect 的 prompt 多渲染一个邻域块,让它一眼看到"种子模块的依赖上下游"。

**零外部依赖**:不引图数据库,不引 networkx 之外的库;邻接表纯 dict + 列表,在内存中跑 BFS 即可。

### 4.3 边语义集合(待主人拍板,见第七节)

候选关系类型:`depends_on` / `contains` / `extends` / `implements` / `references`。最小集只需前两个就能跑;后三个看 mermaid 解析能否稳定识别再决定。

---

## 五、可变记忆全自动方案

### 5.1 实时捕获(per-turn,只 append)

**目标**:每个 turn 自动留一条记忆候选,无需用户说"记一下"。

**机制**:
- `Stop` hook + `SubagentStop` hook [CC-API 待核] 都把当前 turn 的最后一段输出**作为候选**写到 `.cbim/memory/medium/incoming/<ts>.json`(不是 `medium/` 直接落,先进 `incoming/` 队列)。
- 候选格式只含原始素材:`{turn_id, agent, summary_line, signal_words[], created_at}`,不打 MUST/WANT/HOW/IS 标签。
- **信号词集合**(待主人拍板,见第七节)用作粗筛:命中信号词 → 进 incoming;否则丢弃。粗筛规则,确定性,纯字符串匹配。

**重活归 dream**:
- dream `MemPromoteScan` 里加一步 `IncomingTriage`(LLM):把 incoming 队列的素材给主 agent / 架构师判断"值不值得作为 medium",值得就落 `medium/` 并打四象限标签;不值得就清掉。

### 5.2 召回相关性门控

**问题**:不是每条召回都该塞主上下文(噪音 / token 预算)。

**门控**(`UserPromptSubmit` hook 内,确定性):
1. 4 源各拉 top-k(默认 k=5)。
2. **分数门**:`memory_medium` / `transcript` 桶丢掉 score < `min_score`(默认 0.3,可配)。
3. **桶配额**:总注入 ≤ N 字符(默认 3000),按 `dna > agents > memory_medium > transcript` 优先级裁。
4. **去重**:同一 doc_id 只保留分最高的一条。
5. 失败回退空注入(永不阻塞)。

### 5.3 手动 "记一下" / "recall" 退场

- 现状:`memory_create(tier="medium", slug="manual-...")` MCP 工具 + 触发词("记下"/"记住"/"remember this")是主路径。
- 重构后:实时捕获 + 信号词粗筛已经把"日常该记的"自动捕获,**手动命令降级为兜底覆写**——用户说"记一下"时,assistant 仍然走 `memory_create`,但不再是"日常入口"。
- 不删掉手动通道——它仍是用户 override 自动判断的唯一手段。

---

## 六、分阶段落地计划

> 每阶段独立可交付。前一阶段不落地,后续阶段不动工。每阶段标"纯实现"(代码层确定可写)或"需主人产品决策"(有边界要拍板)。

### 阶段 1 — 召回经 hook 注入主上下文 + ContextRetrieval 取舍

**目标**:堵"召回只喂架构师"硬伤。

- 在 `cbim_user_prompt_submit.py` 加 `_build_recall_context(root, prompt)`:跑 4 源 `search`,按 priority 分配预算渲染 `additionalContext(event_name="UserPromptSubmit")`。
- BT `ContextRetrieval` 节点**保留不动**——理由:架构师 `module_knowledge` 是它当前唯一来源,继续服务 architect prompt;受众边界=hook 注入服务 coordinator 主上下文,BT 节点服务 architect prompt,两路并存直到后续阶段统一消解。
- 关键收益:零侵入 dispatch 节点,coordinator 主上下文拿到召回(子 agent 通过 BT 路径仍受架构师渲染服务)。

**类型**:纯实现 + 一个 [CC-API 待核] 阻塞点。

**依赖**:无。

### 阶段 2 — 手动命令退场(降级)

**目标**:把"记一下"从日常入口降为 override。

- 修改 `CLAUDE.md` 的 Memory Routing 表(主项目 + submodule 版本同步):明确"自动捕获是主路径,memory_create 仅作 override"。
- 新增触发词集合的负面提示:"未触发自动捕获时,用户可显式 override"。

**类型**:纯实现(文档级)。

**依赖**:阶段 4 落地后才真有意义(否则降级而捕获没接上,日常无人记)——所以**实际推进顺序应放在阶段 4 之后**,这里编号只是逻辑序。

### 阶段 3 — .dna 图谱关系层

**目标**:给永久知识加邻接表 + 邻域召回。

- 新建 `engine/retrieval/graph/` 模块(leaf):`builder.py`(扫 frontmatter + classdiagram 抽边)、`query.py`(neighbors / subgraph)。
- 新增 `dream` 节点 `DnaGraphRebuild`(全量重建,放在 `MemRebuildIndex` 之后)。
- `SessionStart hook` 加增量 patch 钩子(改一个模块时只更那几条边)。
- `arch_exec_yield._compose_prompt` 在"知识快照"块之后加"邻域上下文"块,渲染种子模块 1 跳邻居。

**类型**:纯实现。

**依赖**:阶段 1(召回管线打通后再加桶)。

**风险**:mermaid 解析的稳定性。建议起步只解析 `..>` 箭头(parent 模块依赖),其他关系类型留待主人决定。

### 阶段 4 — per-turn 实时捕获

**目标**:可变记忆全自动入口。

- 新增 `cbim_subagent_stop.py` hook [CC-API 待核:CC SubagentStop 事件 payload 是否含子 agent 输出全文未确认 → 已按只给 transcript_path 设计,从 transcript 末尾解析 receipt trailer]。
- `cbim_stop.py` 增加信号词粗筛(确定性):命中 → 写 `.cbim/memory/medium/incoming/<YYYY-MM-DD>.jsonl`(队列文件,按日切分)。
- 信号词集合**已在阶段 4 内联**(见 `hooks_src/_lib/turn_capture._SIGNAL_PATTERNS`):四类 `decision` / `rule` / `negation` / `memory_explicit`,暂不外配,等主人觉得需要时再提到 config。
- dream 加 `IncomingTriage` 节点:消费 incoming 队列,yield 给主 agent 判断,落 medium 或 drop。**(本阶段未实装,留给阶段 5。)**

**已落地(2026-06):**

- `hooks_src/_lib/turn_capture.py` — JSONL 反向读、turn 切分、信号词正则、脱敏(纯函数,stdlib-only)
- `hooks_src/_lib/receipt_capture.py` — receipt trailer 解析、redacted line 渲染
- `hooks_src/_lib/incoming_writer.py` — `.cbim/memory/medium/medium/incoming/<YYYY-MM-DD>.jsonl` 追加
- `hooks_src/cbim_stop.py` — 在原有 `_index_transcript` 后追加 `_capture_turn`,失败安全
- `hooks_src/cbim_subagent_stop.py`(新增) — 解析 transcript 尾部 receipt trailer,失败安全
- `templates/settings.json.tmpl` — 注册 SubagentStop event;`sync.py` 加白名单
- 脱敏:`<REDACTED:KEY>`(sk- / ghp_ / xoxb- / AKIA 前缀)+ `<REDACTED:LONG_TOKEN>`(≥32 字符无空格串);邮箱 / IP 保留
- 注:`incoming/*.jsonl` 不会污染 `medium/*.md` 的 mtime-walk(`crud/file_backend.py` 只 glob `*.md`)

**类型**:纯实现 + 一个 [CC-API 待核] + 一个产品决策(信号词集合 — 已采用四类起步集)。

**依赖**:阶段 1。

### 阶段 5 — dream 承接可变 → 永久晋升 + 永久知识压缩

**目标**:闭合记忆生命周期。

- `MemPromoteScan` 现在 flag off。打开 flag,接通到 `ArchitectGovernanceStep`:让架构师在治理模式判断"哪些 candidate 该升 .dna"(产 advice_pending,不直接改 .dna)。
- 新增 dream 节点 `KnowledgeCompact`(架构师治理步内):周期扫 `.dna` 树,识别冗余/过时模块,产出 advice_pending。
- promote_builder 规则 C 的消费端:`scan_for_promote_candidates` 已经能 stage 候选,只需把 candidates → architect prompt 的链路接通。

**类型**:纯实现 + 主人产品决策(蒸馏窗口、晋升判据)。

**依赖**:阶段 3、阶段 4。

---

## 七、需主人拍板的产品边界清单

| 编号 | 边界 | 我的推荐 | 理由 |
|---|---|---|---|
| 1 | **turn 粒度**:一次"用户 prompt → assistant 最终回复"是一个 turn,中间纯工具往返算不算独立 turn? | **不独立成 turn**;只在最终 `Stop` 时捕获一次,中间 `PostToolUse` 不写 medium。 | 工具往返多是 IO,无判断价值;最终回复才有总结性。 |
| 2 | **纯工具往返要不要写 incoming**? | **不写**。 | 同上。 |
| 3 | **图谱边语义集合**(`depends_on` / `contains` / `extends` / `implements` / `references`) | **起步只支持 `depends_on` + `contains`**;后三者等 mermaid 解析能稳定识别再加。 | 最小可用集,先拿到价值。 |
| 4 | **dream 蒸馏窗口**(多久跑一次 IncomingTriage) | 跟 `dream_tick` 现有 20h 节奏一致;不另起独立计时。 | 复用现成调度,避免增加机制。 |
| 5 | **手动 `memory_create` 是否保留**? | **保留作 override**;但从 CLAUDE.md 主路径降为兜底。 | 用户对自动判断的最后控制权,不能拿掉。 |
| 6 | **自动捕获信号词集合**(默认值) | 推荐起步集:`["决定", "选择", "拍板", "规则", "原则", "约定", "记下", "decided", "rule", "principle", "convention", "TIL"]` | 集中在"形成稳定结论"的语义,避免日常对话噪音。 |
| 7 | **召回 token 预算**(注入主上下文的字符上限) | **3000 字符**;超过按 dna > agents > memory_medium > transcript 优先级裁。 | 平衡上下文质量与 token 消耗。 |
| 8 | **召回最低分数门**(`memory_medium` / `transcript` 桶) | **0.3**(BM25 / 余弦混合 RRF 后归一分数);可配置。 | 避免噪音;具体值上线后看曲线调。 |
| 9 | **"已发布"模块的处理**:.dna 模块标记 deprecated/archived 后,是否还参与召回和图谱? | 召回**带上但加标记**;图谱**保留边但 status=archived 渲染时拉低权重**。 | 历史可追溯,不污染新决策。 |

---

## 八、与现状的距离(诚实清单)

1. **"召回只喂架构师"硬伤** — 已勘出,代码确证(见第一节第 2 条)。阶段 1 解决。
2. **`SubagentStop` hook 是否存在** — `[CC-API 待核]`,这是阶段 4 的硬阻塞点。如果 CC 没有该事件,可降级为 `PostToolUse` 在 Task 工具结束时同等捕获,但"sub-agent 输出全文"是否能拿到是另一个问题。
3. **图谱 schema 当前完全不存在** — 阶段 3 是纯增量。
4. **incoming 队列与 medium 的边界** — 当前 `medium/` 直接受写;新增 `incoming/` 子目录是新约定,要写进 memory 的 contract.md(等阶段 4 实装时再写,现在不写)。
5. **promote 链路的消费端** — `scan_for_promote_candidates` 已经能产出候选,但 `ArchitectGovernanceStep` 的 prompt 现在不读 candidates。阶段 5 把这条边接通。
6. **永久知识自身压缩** — 当前 `dream.ArchitectGovernanceStep` 只跑通用治理,没有"压缩"这个具体子任务。阶段 5 加。

---

## 九、不在本蓝图范围

- **embedding 提供方更换**:与本次重构正交,继续用现有 `engine.retrieval.embedding` 工厂。
- **chroma vs file backend 的取舍**:`memory.crud.chroma_backend` 与 `file_backend` 并存,本次重构不动。
- **mcp_server 工具表**:除了上述阶段需要新增的几个查询(`graph_neighbors`、`graph_subgraph`),其他工具不动。

---

## 十、模块边界自检(C1–C6 视角)

- **C3 单向依赖**:`hooks_src/` → `engine.retrieval` 已有(SessionStart 调用过),阶段 1 维持方向不反转。
- **C2 单一职责**:hook = 廉价捕获/注入,BT = 执行,dream = 治理,三者职责不混。
- **C5 共同复用**:同一套 `engine.retrieval.search` 喂三处入口,无重复实现。
- **C1 开闭**:新增 `engine/retrieval/graph/` 是新模块,不改 retrieval facade 的 5 个公开函数。
- **C6 稳定抽象**:`graph.json` 是物化产物,可重建可丢弃;真值仍在 `.dna/module.md`。

---

## 附录 A — 现状证据指针(供后续派工核对)

| 现象 | 文件 | 行 |
|---|---|---|
| 召回拉 4 源写 bb.retrieved_context | `kernel/engine/execution/actions/context_retrieval.py` | 全文 |
| 架构师 prompt 渲染了 module_knowledge | `kernel/engine/execution/actions/arch_exec_yield.py` | `_render_module_knowledge` 317–349 |
| Work Agent prompt 不拼 retrieved_context | `kernel/engine/execution/actions/dispatch_work.py` | `_compose_prompt` 81–102 |
| SessionStart 已用 additionalContext | `kernel/project/hooks_src/cbim_session_start.py` | `write_additional_context` 394 |
| UserPromptSubmit 仅 mark_busy + log_user | `kernel/project/hooks_src/cbim_user_prompt_submit.py` | 全文 |
| Stop 索引 transcript | `kernel/project/hooks_src/cbim_stop.py` | `_index_transcript` 60–89 |
| candidates 工作区 | `kernel/memory/compaction/candidates.py` | 全文 |
| promote_builder feature flag | `kernel/memory/compaction/promote_builder.py` | 41–43 |
| dream 治理 sequence | `kernel/engine/dream/tree/dream_loop.py` | 151–165 |
| BT 主循环 | `kernel/engine/execution/tree/main_loop.py` | `build_root` 117–235 |
| retrieval facade 公共面 | `kernel/engine/retrieval/facade.py` | 5 函数 535–557 |
| retrieval store + VALID_SOURCES | `kernel/engine/retrieval/store.py` | 36 |
