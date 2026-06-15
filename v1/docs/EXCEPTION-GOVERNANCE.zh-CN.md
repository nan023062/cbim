# 异常治理规约（Exception Governance）

> 本文档是 CBIM v1 kernel 异常处理的**单一权威**。Batch 5 异常治理（5.1–5.6）的所有决策与原则都收口在这里；各模块 `.dna/module.md` 的 Key Decisions 只放\"本模块为何这样收紧\"的判断，规约本身指向本文。
>
> **位置**：`v1/docs/`（项目级规约，非 `.dna/`，普通 markdown）。
> **配套验收**：`BLE001 = 0`、`RUF100 = 0`、701 passed、白名单已删、透传协议零告警。

---

## 一、铁律：异常治理三原则

| 原则 | 说明 |
|------|------|
| **C-Tight** | catch 子句的异常类型应**收紧到**实际可发生的窄类型；`Exception` / `BaseException` 是默认违例，必须显式说理由。 |
| **C-Name** | 边界 catch 留名（`as e`）—— 异常对象必须**进日志**或被**重抛**；不允许吞声。 |
| **C-Trace-Then-Raise** | 跨边界透传必须\"记一笔再抛\"：`logger.exception(...)` 后 `raise`；不可静默吞、不可降级为 warning。 |

任何破窗都需在受影响模块 `.dna/module.md` 的 Key Decisions 显式留白，并在 catch 行紧贴 `# noqa: BLE001 — <一句话理由>`。

---

## 二、六类合法 broad-catch 边界（白名单已删，逐处 noqa 留名）

历史曾有 `pyproject.toml` 的 BLE001 文件级豁免白名单。Batch 5.6 已**全部删除**，改为**逐处 `# noqa: BLE001 — <理由>`**——白名单是\"看不见的破窗集合\"，逐处 noqa 才有审计权重。

| # | 边界类型 | 典型场景 | 收紧后类型 / 保留 broad 理由 |
|---|---------|---------|----------------------------|
| 1 | **原子写 cleanup-raise** | `tempfile` + `os.replace` 失败后 `os.unlink` cleanup | 收紧到 `OSError`：cleanup 只可能因 IO/权限失败；其他异常应裸抛。 |
| 2 | **总 rollback / undo 帧** | splitter stage2 失败后回滚已写文件、persistence 多步事务的 finally rollback | **保留 broad** + noqa 说明：rollback 路径需吃下任意子步异常以保证主异常上抛；窄化会让真正的根因被次生异常掩盖。 |
| 3 | **进程入口 / CLI 顶层** | `main()` 的最外层、MCP server tick 入口、hook subprocess 入口 | **保留 broad** + noqa：进程边界必须落地 stack trace 与退出码；任何泄漏会造成无声崩溃。 |
| 4 | **配置 / 启动 best-effort** | `.cbim/config.json` 覆盖加载、可选索引重建、warmup | 收紧到 `(OSError, json.JSONDecodeError, KeyError)` 之类**并列 tuple**；失败需 `print(..., file=sys.stderr)` 警告而非静默。 |
| 5 | **第三方 SDK 透传** | `mcp` / `tomllib` / 第三方 retrieval 后端 | **保留 broad** + noqa：第三方异常树不稳定；窄化会随上游版本碎裂。但必须 `logger.exception` 留迹（Trace-Then-Raise）。 |
| 6 | **Trace-Then-Raise 报警边界** | 跨模块边界、跨进程边界的异常透传节点 | **保留 broad** + noqa + 必须 `raise`：吞了任何一处都属于破窗。 |

> **禁用 `BaseException`**——除非显式处理 `KeyboardInterrupt` / `SystemExit` 重抛，否则一律按 `Exception` 起步，再视情况收紧。`BaseException` 的破坏面包含信号与解释器退出，超出业务边界。

---

## 三、收紧原则（Tightening Order）

按以下优先级评估每处 broad catch：

1. **`OSError` 优先** —— 任何文件/进程/socket 操作失败的天然窄类型；先尝试 `OSError`，覆盖不到再考虑下一档。
2. **`OSError` + 具体 tuple 并列** —— 例如 `(OSError, json.JSONDecodeError)` / `(OSError, RuntimeError)`。tuple 不超过 4 个；超过即说明此处不是边界，是漏抽象。
3. **领域异常基类** —— 自定义异常族（如 `CBIMError`）做 catch 时只 catch 该基类，不要混叠 `Exception`。
4. **保留 broad** —— 走完前三档仍无法窄化、且属于第二节六类边界之一时，方可保留 `Exception` 并紧贴 noqa 留名。

收紧后**必须重跑全量测试**（≥ Batch 5.6 的 701 用例）：很多窄化会暴露过去 broad 掩盖的实际异常类型，需要补 corruption fixture。

---

## 四、`# noqa` 模板

```python
# 收紧形（推荐）
except OSError as e:
    logger.warning("config override failed: %s", e)

# 并列收紧形
except (OSError, json.JSONDecodeError) as e:
    print(f"[cbim] config override unreadable: {e}", file=sys.stderr)

# 保留 broad 形（必须 noqa + 一句话理由）
except Exception:  # noqa: BLE001 — stage2 总 rollback 必须吃下任意子步异常以保主异常上抛
    _rollback_split_targets(written)
    raise

# 进程入口（必须 noqa + Trace-Then-Raise）
except Exception:  # noqa: BLE001 — CLI 顶层须落地 stack trace
    logger.exception("cbim cli crashed")
    sys.exit(2)
```

**禁用形**：

```python
except:                           # 裸 except——禁
except BaseException:             # 除非显式重抛 KeyboardInterrupt/SystemExit——禁
except Exception:                 # 没有 noqa 理由——禁
except Exception as e: pass       # 吞声——禁
except Exception: logger.warning  # 只 warning 不 raise（透传场景）——禁
```

---

## 五、透传报警协议（Trace-Then-Raise）

跨边界透传必须严格落实：

```python
try:
    do_cross_boundary_call()
except Exception:  # noqa: BLE001 — 透传报警边界
    logger.exception("cross-boundary call failed at <module>.<func>")
    raise
```

- **`logger.exception`**（不是 `logger.error`）—— 自动带 stack trace。
- **`raise`** 紧随其后，不带参数 —— 保留原异常链。
- **不允许**降级为 `warning` / `info` / `print`：透传节点的责任是\"留迹+上抛\"，不是\"消化\"。

任何透传节点漏 `raise` 是破窗；任何吞声为零告警是破窗。Batch 5.6 验收\"透传协议零告警\"指的就是该形态在 catch 后无 silent-swallow 残留。

---

## 六、`# noqa: F401` / `RUF100` 协同规则

`RUF100` 检测\"无效的 noqa\"。Batch 5.6 期间发生过一次：`session_log.py:9` 的 `# noqa: F401` 被 ruff 标为 RUF100 命中。

**判定流程**：

1. 若文件**已声明 `__all__`**，且该 import 名在 `__all__` 中 —— ruff 自动认定 re-export，`# noqa: F401` 是冗余 → **直接删除 noqa**（机械清理，不算 ruff 行为变化）。
2. 若 RUF100 命中**不**是上述情况，而是 ruff 升级 / 规则集变更 —— 这是 ruff 行为变化，**停手 NEEDS_ARCH_DECISION**，由架构师裁定回退或调整 ruff 配置。
3. 不允许用文件级 `ruff: noqa` 抑制单点 RUF100 —— 文件级抑制比单点 noqa 更重，会掩盖未来其它行的真实违规。

---

## 七、Batch 5.6 完成标准（权威）

| 维度 | 标准 |
|------|------|
| BLE001 | `v1/kernel/` 全量 = 0 |
| RUF100 | `v1/kernel/` 全量 = 0 |
| 测试 | 701 passed（含 36 个新 corruption fixture） |
| 白名单 | `pyproject.toml` BLE001 文件级豁免清单**已删净** |
| 收紧 | 14 处明确收紧（OSError / 并列 tuple / 领域基类） |
| 保留 broad | 5 处保留 + 紧贴 noqa 一句话理由 |
| 透传协议 | 零告警（无 silent-swallow 残留） |

> **不在 Batch 5.6 范围**：`v1/kernel/` 全量 ruff exit 0。当前预存约 1410 条 lint debt（I001 / UP037 / E702 / SIM105 / TID252 等），属历史项，归未来批次（整体 lint debt 清零）；与异常治理无关。

---

## 八、留给未来批次

| 项 | 归属 |
|----|------|
| 历史 1410 条 lint debt 清零（I001 / UP037 / E702 / SIM105 / TID252 等） | 未来 lint-cleanup 批次，与异常治理解耦 |
| `CBIMError` 领域异常族落地 | Batch 6+；当前各模块仍以 `OSError` / `RuntimeError` / `ValueError` 等为主 |
| `logger.exception` 在第三方 SDK 边界的覆盖率审计 | 治理循环可加一条 audit 检查（统计 broad catch 后是否有 `logger.exception`） |

---

## 引用与回溯

- 配套 module.md Key Decisions（指向本文）：
  - `v1/kernel/cbi/_primitives/.dna/module.md` —— 原子写 cleanup-raise 收紧到 OSError；splitter stage2 总 rollback 保留 broad。
  - `v1/kernel/memory/.dna/module.md` —— config 覆盖失败 stderr 警告而非静默。
  - `v1/kernel/engine/audit/.dna/module.md` —— BaselineStore.save 原子写收紧 OSError。
- 配套测试目录：`v1/tests/`（36 个新 corruption fixture）。
- 配套配置：`pyproject.toml`（BLE001 文件级豁免清单已删；RUF100 启用全量）。
