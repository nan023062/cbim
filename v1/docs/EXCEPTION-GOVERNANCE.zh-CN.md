# 异常治理规约

本文档定义 CBIM V1 的异常处理边界。目标是让错误可见、边界清晰，避免用宽泛捕获
隐藏真实故障。V1 没有 MCP、生命周期 hook、后台调度或 Dashboard；CLI 和 service
是主要边界。

## 铁律

1. 优先捕获实际可发生的窄类型，例如 `OSError`、`ValueError`、`json.JSONDecodeError`。
2. 跨模块边界不得静默吞错；需要降级时必须说明原因并报告结果。
3. 只有原子回滚、CLI 顶层和不可控第三方适配边界，才允许保留 `Exception`，并在代码中
   用 `# noqa: BLE001 — ...` 写明理由。
4. 不捕获 `BaseException`，除非明确处理后重新抛出 `KeyboardInterrupt` 或 `SystemExit`。
5. 不以日志代替用户可见结果；写入成功但索引失败时，必须分别报告两者状态。

## 合法边界

| 边界 | 处理方式 |
|---|---|
| 原子写清理 | 通常捕获 `OSError`，不覆盖主异常 |
| 多步回滚 | 可捕获 `Exception`，执行回滚后重新抛出主异常 |
| CLI 顶层 | 可捕获 `Exception`，输出可诊断错误并以非零状态退出 |
| 配置加载 | 捕获文件和解析异常，给出明确警告或错误 |
| 可选第三方后端 | 捕获其实际异常族；不可控时保留 broad catch 并报告 |

## 推荐形态

```python
try:
    atomic_write(path, text)
except OSError as exc:
    raise StorageError(f"cannot write {path}: {exc}") from exc
```

CLI 顶层需要保留 traceback 时，必须在错误输出中说明命令和异常；不应把错误转换成
成功结果。测试应覆盖损坏文件、权限错误、路径越界、索引失败和回滚失败。

## 验证范围

使用项目当前 `pyproject.toml` 的 ruff 规则检查 `BLE001` 与无效 `noqa`。本规约不承诺
历史批次的测试数量；以当前保留的 service、resource、memory、CLI 和安全测试结果为准。
