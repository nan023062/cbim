# src/backend/engines 架构

## 目录定位

具体引擎适配边界：Pi、Claude、Codex 及其共享 HTTP 预算传输和原生工具加载。依赖 Core 的引擎/模型契约，由 scheduler-engine/assembly 选择并注入；不持有任务派发与应用存储。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [native-tools.ts](native-tools.ts) | 向宿主托管引擎提供已有文件/命令工具操作，复用 Pi SDK 的独立工具实现而不创建 Pi Loop。 |

## 架构类图

```mermaid
classDiagram
class N_src_backend_engines_claude["claude/"] {
  <<directory>>
}
class N_src_backend_engines_codex["codex/"] {
  <<directory>>
}
class N_src_backend_engines_pi["pi/"] {
  <<directory>>
}
class N_src_backend_engines_transport["transport/"] {
  <<directory>>
}
class N_src_backend_engines_native_tools_ts["native-tools.ts"] {
  <<module>>
}
N_src_backend_engines_claude ..> N_src_backend_engines_transport : 导入依赖
N_src_backend_engines_codex ..> N_src_backend_engines_native_tools_ts : 导入依赖
N_src_backend_engines_codex ..> N_src_backend_engines_transport : 导入依赖
N_src_backend_engines_pi ..> N_src_backend_engines_transport : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `claude` → `transport`：导入。
- `codex` → `native-tools.ts`：导入。
- `codex` → `transport`：导入。
- `pi` → `transport`：导入。

### native-tools.ts 公开入口

```mermaid
classDiagram
class N_src_backend_engines_native_tools_ts["native-tools.ts"] {
  <<module>>
  +managedNativeTools()
}
```


## 子目录导航

- [claude/](claude/ARCHITECTURE.md)：Claude Agent SDK 适配、内部工具门禁与真实原生会话生命周期；环境和账号归 CBIM，工具复用上层契约，不提供对外 MCP。原生工具开关只读可信能力的 disableNativeTools 策略，不认识具体业务工具槽位。
- [codex/](codex/ARCHITECTURE.md)：Codex App Server 的受管进程、双向 RPC、真实 thread/turn、Responses 代理与动态工具；固定 CLI 和私有账号目录，内置执行关闭，工具经宿主授权、预算结算及同一回执；宿主原生工具目录按可信能力的 disableNativeTools 策略收窄。
- [pi/](pi/ARCHITECTURE.md)：Pi 协议、临时桥与运行参数；插入在原生状态查询后复核取消，发送后只凭queued回复确认，不自动重试。工具经一次性gate授权并校验结果；结构验证仅在正式成员有冻结要求及真实端口时公开。受控续执行在启动及加载原生会话后再核冻结证明，回传作为custom数据，不冒充用户授权。 范围模式只注册cbim工具，转发受限读取与隔离Node的原调用身份。 主角色提示要求未配置自定义岗位时自己执行；内置默认执行角色已退役，不能登记后绕过主会话。 受控文件工具仅在真实端口存在时安装，维持桥接容量及调用授权，工具结果和实际文件操作终态分别校验。
- [transport/](transport/ARCHITECTURE.md)：引擎 HTTP 请求预算与计量适配。通过 Core 的 ModelRequestBudgetPort 预占、结算或记录未知结果；网络实现与稳定模型端口分离，保留各引擎错误和取消语义。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
