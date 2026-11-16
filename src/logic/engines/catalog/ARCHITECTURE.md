# src/logic/engines/catalog 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

开发者在代码中声明官方支持引擎；清单随 Logic 资源发布，声明只读，不支持用户注册或配置覆盖。

## 类与模块的设计意图

下表依据源码声明及文件头说明定位封装。字段表示该实例持有的状态或协作引用，不表示它拥有被引用服务的生命周期；实际资源责任和调用限制见下文契约及源码注释。

| 类／模块 | 实现形式与实例字段 | 封装依据 |
| --- | --- | --- |
| [supported-engines.ts](supported-engines.ts) | 函数／契约模块 | 身份、业务专长和模型协议声明集中维护；清单不加载具体 SDK，也不开放用户注册或配置文件覆盖。 |

## 接口设计契约

<a id="contract"></a>

静态条目同时声明受管原生目录名和依赖种类；Codex 声明 Pi，准确版本摘要由签名制品锁定。字段不可由用户或远端索引覆写。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [supported-engines.ts](supported-engines.ts) | 源码模块 | 开发者维护的官方 Agent Loop 引擎静态清单，随 Logic 资源发布。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

### supported-engines.ts

```mermaid
classDiagram
class N_src_logic_engines_catalog_supported_engines_ts["supported-engines.ts"] {
  <<module>>
}
class N_src_logic_engines_catalog_supported_engines_ts_EngineDeclaration["EngineDeclaration"] {
  <<interface>>
  +id
  +storageDirectory
  +nativeHistoryFormat
  +packageDependencies
  +label
  +businessTypes
  +supportedApis
  +fallbackApi
  +additionalModelRoles
}
N_src_logic_engines_catalog_supported_engines_ts ..> N_src_logic_engines_catalog_supported_engines_ts_EngineDeclaration : 声明
class N_src_logic_engines_catalog_supported_engines_ts_LoopEngine["LoopEngine"] {
  <<type>>

}
N_src_logic_engines_catalog_supported_engines_ts ..> N_src_logic_engines_catalog_supported_engines_ts_LoopEngine : 声明
class N_src_logic_engines_catalog_supported_engines_ts_EngineDescriptor["EngineDescriptor"] {
  <<type>>

}
N_src_logic_engines_catalog_supported_engines_ts ..> N_src_logic_engines_catalog_supported_engines_ts_EngineDescriptor : 声明
```

直接依赖：[../model-roles.ts](../model-roles.ts)、[../../models/index.ts](../../models/index.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
