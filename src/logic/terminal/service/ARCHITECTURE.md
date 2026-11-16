# src/logic/terminal/service 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

逐条命令执行及持续 UTF-8 解码；关闭释放当前进程，不模拟 PTY 或跨命令 shell 会话。

## 类与模块的设计意图

下表依据源码声明及文件头说明定位封装。字段表示该实例持有的状态或协作引用，不表示它拥有被引用服务的生命周期；实际资源责任和调用限制见下文契约及源码注释。

| 类／模块 | 实现形式与实例字段 | 封装依据 |
| --- | --- | --- |
| [TerminalSessions](terminal.ts) | 实例类；持有 `entries` | 不向渲染层暴露 Node；Windows 进程内约定 UTF-8 输出，各输出流持续解码，避免系统代码页和分块破坏中文。 |

## 接口设计契约

- [terminal.ts](terminal.ts)：边界：这是逐条命令执行器，不模拟 PTY；交互式程序及跨命令 cd 状态不受支持。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [terminal.ts](terminal.ts) | 源码模块 | 桌面扩展区的命令模式终端，按工作区/页签隔离手动命令与输出。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；`function` 为函数值成员，`get`／`set` 为访问器。调用／构造／索引签名按匿名签名列出，不虚构方法名；`global.` 表示全局声明补充，非运行时嵌套类。构造函数单独列出，运行时私有字段保留 `#`。文档和资源仅在文件清单中导航，不作为代码节点。

### terminal.ts

[查看源码](terminal.ts)。

```mermaid
classDiagram
class N_src_logic_terminal_service_terminal_ts["terminal.ts"] {
  <<module>>
}
class N_src_logic_terminal_service_terminal_ts_TerminalSessions["TerminalSessions"] {
  +Start()
  +Read()
  +Close()
  +CloseAll()
  -entries
}
N_src_logic_terminal_service_terminal_ts ..> N_src_logic_terminal_service_terminal_ts_TerminalSessions : 声明
```



## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
