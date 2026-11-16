# src/bridge 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

通信契约、可信服务端和 preload；业务状态归 Logic，平台技术机制归 Core 独立入口。

## 类与模块的设计意图

本层没有直接源码声明，负责组合下级封装；各子系统的类、状态与公开入口见本文的[子目录导航](#子目录导航)。

## 接口设计契约

<a id="contract"></a>

<a id="contract-桥接层"></a>

### 桥接层

contracts 定义消息和纯数据，server 负责可信宿主消息分发、桌面/CLI 与启动，preload 负责受限渲染进程接入。服务端可使用 Logic 的明确入口；契约与浏览器端不能加载 Node/Electron 或业务服务。业务数据类型归 Logic，Bridge 具名转接所需类型。

server/application.ts 只给 Logic Application 增加 dispatch，复用同一个构造和生命周期；IPC handlers 面向 ApplicationServices，不反向导入具体 Application。server/platform 处理 Electron utility 的私有传输，业务权限、Win32 操作与恢复仍归 Logic。

bootstrap 只加载验签后的固定业务入口与更新服务。构建仍输出 desktop.js、main.js、controlled-file-child.js 等原文件名；用户数据、R/E 缓存和升级清单格式没有改变。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |

本层无直接代码文件。

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

```mermaid
classDiagram
class N_src_bridge_contracts["contracts/"] {
  <<directory>>
}
class N_src_bridge_preload["preload/"] {
  <<directory>>
}
class N_src_bridge_server["server/"] {
  <<directory>>
}
N_src_bridge_preload ..> N_src_bridge_contracts : 导入依赖
N_src_bridge_server ..> N_src_bridge_contracts : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `preload` → `contracts`：导入。
- `server` → `contracts`：导入。

## 子目录导航

- [contracts/](contracts/ARCHITECTURE.md)：可序列化 IPC 与展示契约；多来源附件只传选择身份，公开旧v1/新v2清单与真实仓库目录，不暴露凭据。图增量公开前置追加/替换审计而非执行许可，目标摘要公开运行内补充计数与未核实状态，详情保留已接收快照，纯协议不携IO。排队插入必须传用户点击时的原主run，缺失不推测当前轮次。检查点私有恢复证明留在后端；结构验证公开当时文件/规则指纹及无原值诊断，人工决定与文件观察保留真实依据。岗位IPC只传明确选择与公开采纳/回执，类型不带凭据或后端哈希IO。 桌面更新只公开版本、日志、阶段和进度，不传安装路径或任意命令。 ipc-call 用联合元组关联全部172项操作（含1项退役拒绝）；分组契约共享请求Schema与响应，纯workspace-view避免类型循环。 owner-execution 公开原岗位绑定与显式当前观察；按任务修订核对身份，不公开解密配置。 公开检查点放弃审计和请求/回执纯契约，不向渲染进程授予主调度处置身份。 command-verification 只导出严格公共报告和八工具支持矩阵，隐藏原事务和执行准备信息。 effect-observation 只公开来源联合及严格公共 DTO，恢复／重规划保留旧协议并显式绑定新处置，不暴露正文备份或原生上下文。 controlled-files 仅导出公开纯协议与限制，隐藏 blob、原生文件身份、句柄和后端规则。
- [preload/](preload/ARCHITECTURE.md)：固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。 实现关联调用签名并沿原信封转发，不重试错误或改变主Frame授权。
- [server/](server/ARCHITECTURE.md)：可信宿主桥接：桌面/CLI 入口、IPC 处理和业务 Application 的通信适配；业务状态与生命周期归 Logic。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
