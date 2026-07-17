# engine/retrieval — 对外契约

> 本契约定义检索原语库对外暴露的全部接口。**5 个接口**：3 个写入（`index_upsert` / `index_delete` / `verify_consistency`）+ 2 个读取（`search` / `stats`）。任何内部原语（embedding provider 选择、BM25 vs vector 路由、索引文件格式）都不在契约内。

---

## 契约硬约束

| 约束 | 说明 |
|------|------|
| **不主动扫文件** | 5 个接口都是同步调用；本模块不起后台线程、不订阅事件、不启 watcher。 |
| **不 emit 事件** | 写入、检索、校验都不产生事件、不写跨模块日志（模块内部观测除外）。 |
| **不区分调用者** | 接口不接受、不感知 `agent_type` / `caller_role`。同一查询条件谁来调结果都一样。 |
| **接口语义对源一视同仁** | 所有接口都带 `source: str` 参数；不为某个源开专门方法。新增源 = 调用方传新字符串，本契约不变。 |
| **同步语义** | `index_upsert` 返回后，则该 doc 在下一次 `search` 中可被检到。`index_delete` 返回后不再被检到。不需要 flush 调用。 |
| **`is_available()` 降级透明** | 调用方**不需要**手动判断 embedding 是否可用；`search` / `index_upsert` 内部会查，不可用时自动走 BM25。但接口返回的 `Hit.score` 含义随后端变（cosine vs BM25 归一化），调用方只能用于排序不能用于阀值。 |
| **接口集稳定** | 这 5 个接口签名按公共契约级别管理：新增字段可向后兼容追加，删除/重命名/语义变更需走 contract 变更流程。 |

---

## `source` 枚举

这是公共契约的一部分。现有枚举值：

| source | 对应数据源 | 写入责任人 |
|--------|----------|-----------|
| `"transcript"` | `~/.claude/projects/<project-slug>/*.jsonl`（CC 对话转录） | `.claude/hooks/cbim_session_stop.py` |
| `"memory_medium"` | `.cbim/memory/medium/*.md` | `memory.crud.write` / `update` / `delete` |
| `"dna"` | `**/.dna/{module.md, contract.md, workflows/*, notes/*}` | `mcp_server.tools.dna.*`（`dna_edit` / `dna_init` / `dna_split` / `dna_deprecate` 等） |
| `"agents"` | `.claude/agents/**/*.md` | `mcp_server.tools.agents.*`（`agent_update` / `agent_init` / `agent_archive` 等） |

新增 `source` 枚举值需走 contract 变更流程（与新增接口同级）。

**dna 源 ingest 覆盖面变更历史**：2026-07-10 新增 `notes/*.md`（根模块 D8 决定）。`.dna/notes/<slug>.md` 为模块补充说明层，详细读者面向。写入责任人仍为 `mcp_server.tools.dna.*`——具体经 `dna_edit(target="note")` 分支。

## `index_upsert` — 写入或更新一条索引

| 字段 | 内容 |
|------|------|
| 用途 | 把 `(source, doc_id, content, metadata)` 写入或更新到索引 |
| 输入 | `source: str`（枚举）、`doc_id: str`（在该 source 内唯一）、`content: str`（全文）、`metadata: dict`（任意可 JSON 序列化键值对，供 `search` filter 使用） |
| 输出 | `None`（成功）或抛 `RetrievalError`（缺参 / source 未知 / IO 失败） |
| 副作用 | 同步写索引文件 + 更新内存索引；同步调 embedding provider（如可用）；同步更新 BM25 词频表 |
| 幂等性 | 同 `(source, doc_id)` 重复调用为更新；不重复写入多条 |
| 稳定承诺 | 函数签名锁死；`metadata` 可任意扩展（后端透传）不需接口变更 |

---

## `index_delete` — 删除一条索引

| 字段 | 内容 |
|------|------|
| 用途 | 把 `(source, doc_id)` 从索引中移除 |
| 输入 | `source: str`、`doc_id: str` |
| 输出 | `None`（成功）或抛 `RetrievalError` |
| 幂等性 | 不存在该 doc_id 返回成功（不报） |
| 稳定承诺 | 同上 |

---

## `search` — 检索

| 字段 | 内容 |
|------|------|
| 用途 | 在指定 `source` 内查找与 `query` 最相关的 `top_k` 条 |
| 输入 | `source: str`、`query: str`（自然语言 / 关键词）、`top_k: int = 10`、`filters: dict \| None`（按 metadata 键值过滤，与入库时的 metadata 匹配） |
| 输出 | `list[Hit]`，按相关性降序；无命中返回空列表 |
| `Hit` 字段 | `{doc_id: str, source: str, score: float, content: str, metadata: dict}` |
| 后端语义 | embedding 可用时 cosine 相似度；不可用时 BM25；调用方不感知。可选启用混合检索（RRF）——但由本模块配置决定，不进接口 |
| 失败语义 | source 未知 → 抛；索引未初始化 → 返回空列表 |
| 稳定承诺 | `Hit` 字段名锁定；新增字段可向后兼容追加 |

---

## `verify_consistency` — 漂移校验

| 字段 | 内容 |
|------|------|
| 用途 | 检查索引与原始数据文件之间是否一致；发现漂移后**自动修复**（重跑 upsert / delete），返回报告 |
| 输入 | `source: str`、`mode: str ∈ {"fast", "full"}`（fast = mtime+size；full = sha256 hash） |
| 输出 | `DriftReport{source, mode, checked: int, drifted: list[doc_id], repaired: list[doc_id], failed: list[{doc_id, error}], duration_ms}` |
| 副作用 | 检查过程只读原始数据文件；修复过程会写索引文件（同 `index_upsert` / `index_delete`） |
| 使用场景 | `mode="fast"` 由 SessionStart hook 调用，必须 < 1 秒；`mode="full"` 由治理循环（`engine/dream` 的 MemRebuildIndex）调用，可能耗时几十秒 |
| 失败语义 | source 未知 → 抛；单个文件修复失败 → 进 `failed` 列表不中断 |
| 稳定承诺 | `DriftReport` 字段名锁定；`mode` 枚举锁定（新增走契约变更） |

---

## `stats` — 索引统计 / 观测

| 字段 | 内容 |
|------|------|
| 用途 | 返回索引健康度指标；供 dashboard / 治理循环判断是否需要重建 |
| 输入 | `source: str \| None`（None = 所有 source） |
| 输出（结构稳定） | `IndexStats{source, total_docs: int, vector_dim: int \| None, embedding_provider: str, fallback_active: bool, index_size_bytes: int, last_upsert_at: str, last_verify_at: str \| None, last_drift_count: int \| None}` |
| 调用者依赖 | dashboard 的"索引状态"面板；`audit` 的索引阈值判断；dream 循环 MemHealthScan |
| 稳定承诺 | 现有字段名与含义不变；新增字段可向后兼容追加 |

---

## `EmbeddingProvider` 配置

`EmbeddingProvider` 是内部抽象，不进接口契约。但其**选择机制**是公共契约的一部分：

- 配置文件 `.cbim/retrieval/config.json`（路径进契约），字段：
  - `provider: str ∈ {"openai", "local", "null"}`（默认 `"null"`：零配置安装走 BM25）
  - `openai_api_key_env: str`（环境变量名，默认 `"OPENAI_API_KEY"`）
  - `openai_model: str`（默认 `"text-embedding-3-small"`）
  - `local_model_path: str`（`provider="local"` 时必填）
  - `hybrid_search: bool`（默认 `false`；true 时 vector + BM25 走 RRF 融合）
- 运行时切换 provider 需重建索引（调 `verify_consistency(mode="full")` 会自动重建）。
- 接口集不随 provider 变更变化。

---


## Recency weighting

`RetrievalConfig` 新增分源半衰期配置（可选），用于对**内容本身承载时间语义的源**在排序阶段应用时效性衰减乘子。

- 配置字段（写入 `.cbim/retrieval/config.json`）：
  - `recency_half_life_days: dict[str, float]`，示例默认值 `{"memory_medium": 60.0, "transcript": 30.0}`
  - `dna` / `agents` **不启用**衰减 —— 未列入该字典或值为 0/缺失即视为关闭
- 衰减公式（facade 内部混排排序时应用，与 programmer 实现一致）：
  ```python
  age_days = (now - created_at).total_seconds() / 86400.0
  multiplier = 0.5 ** (age_days / half_life_days)
  final_score = base_score * multiplier
  ```
  等价数学形式：`multiplier = exp(-ln(2) * age_days / half_life_days)`（注意必须带 `ln(2)` 因子；`exp(-age/half_life)` 不满足半衰期语义）。自检：
  - `age_days = 0` → `multiplier = 1.0`（新鲜条目不打折）
  - `age_days = half_life_days` → `multiplier = 0.5`（半衰期定义）
  - `age_days = 2 * half_life_days` → `multiplier = 0.25`
  - `age_days = 3 * half_life_days` → `multiplier = 0.125`
  
  `base_score` 是 embedding / BM25 / RRF 融合的原始得分；`created_at` 从命中条目的 metadata 取（`memory_medium` 用 `created_at`，`transcript` 用 mtime），缺失即视为“无时间语义”跳过乘子（`multiplier = 1.0`）。
- 关闭方法：把该源的半衰期设为 `0` 或从字典中移除即可。
- **契约边界**：5 函数签名与 `Hit` 字段（`{doc_id, source, score, content, metadata}`）不变；`Hit.score` 语义仍为“用于排序的相对得分”，调用方不能用它作阀值判断（与 embedding/BM25 后端切换时的既有约束一致）。半衰期配置对调用方透明，是本模块内部的排序策略，新增 / 修改半衰期不走 contract 变更流程。
- **默认值可调**：`medium=60 天 / transcript=30 天` 是本次落地的示例默认，后续可在实践中调整而不产生契约变更。

## 索引存储路径（公共契约）

```
.cbim/index/
  config.json                # provider 配置、hybrid 开关、schema_version
  <source>/                  # transcript / memory_medium / dna / agents
    meta.json                # {doc_id: {mtime, size, sha256, indexed_at}}
    vectors.bin              # 二进制 [N, dim]，provider 可用时存在
    bm25.json                # 倒排 + doc 长度
    docs/<doc_id>.txt        # 原文快照（供 BM25 重建与 search 返回 content）
```

- dashboard / debug 可只读消费这套布局（不走 MCP）。
- `schema_version` 递增 + 向后兼容读取。
- 不保证跨主机可携——`vectors.bin` 是 endian / dim 敏感的。跨主机迁移需重建。

### 写入工件（实现细节，非契约消费面）

`persist_atomic` 把 `meta.json` / `bm25.json` / `vectors.bin` 三个文件作为一笔事务写入；过程中会在 `<source>/` 内创建以下工件：

```
.cbim/index/<source>/
  .lock                      # 跨进程互斥文件（POSIX flock / Windows msvcrt.locking）
  .staging/                  # 阶段写目录；事务成功后删除
    meta.json
    bm25.json
    vectors.bin
  meta.json.bak              # 仅在轮转重命名期间存在；事务成功后删除
  bm25.json.bak
  vectors.bin.bak
```

- 这些工件**不是公共契约消费面**——dashboard / debug / 用户脚本不应读取或依赖它们。
- `IndexStore` 初始化时 best-effort 清理任何遗留的 `.staging/` 与 `*.bak`，保证下一次 `persist_atomic` 从干净状态起跑。
- `.lock` 文件**创建后从不删除**（轻量、无用户可见副作用），其他三类工件在事务正常结束时由 `persist_atomic` 自身清除。
- `.gitignore` / `.cbim/.gitignore` 应包含整个 `.cbim/index/` 路径；以上工件天然不进版本库。

### 写入语义开关（emergency-fallback）

`RetrievalConfig.atomic_persist: bool = True`（写入 `.cbim/retrieval/config.json` 的 `atomic_persist` 字段），含义：

| 取值 | 行为 | 用途 |
|------|------|------|
| `True`（默认） | 三文件经由 `persist_atomic` 一笔事务写入；要么三个一起到位，要么全部回滚 | 正常生产路径 |
| `False` | 退回到逐文件 `os.replace`，无跨进程锁、无三文件一致性保证 | **emergency-fallback only**：仅在 staging 路径出现现场故障（如平台重命名异常）需要临时绕过时使用；不是性能旋钮，不允许长期开启 |

约束：`atomic_persist=False` 是降级开关，不是调优旋钮。文档、默认值、测试用例都锚定 `True`；emergency-fallback 状态结束后必须复位。任何对此值的批量改动需走 contract 变更流程。

## 不在契约内的部分

| 项 | 归属 |
|----|------|
| EmbeddingProvider 实现类 | 内部；通过 `config.json` 选择，不需调用方感知 |
| VectorIndex / BM25Index 算法细节 | 内部；可换实现但不改变接口 |
| RRF 融合参数 | 内部；k 值 / 权重不进接口 |
| BM25 分词策略 | 内部；中文 jieba / 英文 whitespace、停用词表都不进接口 |
| 索引二进制格式 | 内部；可升级但需 `schema_version` 调高 + 老文件可读 |
| 写入并发控制 | 内部；调用方不感知锁 |
| 索引入口触发逻辑 | 不在本模块；“写什么、何时写”完全在调用方（写入工具的同步副作用） |
| 调用方拼装 3 类 / N 类上下文 | 不在本模块；属于 `engine/execution` 的 retrieval 节点语义 |
