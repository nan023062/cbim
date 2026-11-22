# 引擎包管理

## 设计意图

把官方引擎声明接到资源插件管理器，统一安装、活动版本、依赖和运行引用。执行取得固定包及 retain 释放函数，运行期间不重新选择最新版；制品准备通过注入端口完成。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [服务入口](index.ts) | 公开 EnginePackages。 |
| [EnginePackages](engine-packages.ts) | 组合 PluginManager，核验引擎制品并实现运行包解析端口。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_1470ef04815f["EnginePackages"]
click N_1470ef04815f href "engine-packages.ts"
class N_4c3d1158b669["服务入口"] {
  <<module>>
}
click N_4c3d1158b669 href "index.ts"
class N_bece42afd05a["EngineRuntimeResolver"] {
  <<boundary>>
}
click N_bece42afd05a href "../../logic/execution/rules/engine-runtime.ts"
N_4c3d1158b669 ..> N_1470ef04815f : 依赖
N_bece42afd05a <|.. N_1470ef04815f
```

外部继承／实现边界：[EngineRuntimeResolver](../../logic/execution/rules/engine-runtime.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
