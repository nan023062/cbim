# src/view/workspace 架构

<a id="contract"></a>

## 设计意图

以业务模块树组织源码浏览与负责人管理，连接工作对象、责任关系和正式知识。

`WorkspaceView` 组合模块与配置入口，源码树按需读取绑定目录，责任命令控制器及 Pool 在多个视图间共享原命令。知识编辑和治理委托对应页面模块；源码预览保持只读，负责人选择仍经预览、明确提交和回执核实。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ModuleOwnershipCommands](module-ownership-state.ts) | 维护模块负责人操作的持久原命令与回执核对。 |
| [ModuleOwnershipCommandPool](module-ownership-state.ts) | 在业务架构与岗位视图之间共享负责人命令控制器。 |
| [WorkspaceView](WorkspaceView.tsx) | 业务模块与绑定源码的目录树、只读源码预览及配置治理入口。 |
| [ModuleOwnershipPanel](ModuleOwnershipPanel.tsx) | 业务架构和项目岗位共用的模块责任控制面，提供岗位选择、登记入口、预览、明确提交和原命令核实。 |
| [ModuleSourceTree](ModuleSourceTree.tsx) | 业务模块语义树及其绑定源码目录的按需浏览。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_86f28732d67f["ModuleOwnershipCommandPool"]
click N_86f28732d67f href "module-ownership-state.ts"
class N_5b41e4ed1e4d["ModuleOwnershipCommands"]
click N_5b41e4ed1e4d href "module-ownership-state.ts"
class N_12e22f6e4ffe["ModuleOwnershipPanel"] {
  <<component>>
}
click N_12e22f6e4ffe href "ModuleOwnershipPanel.tsx"
class N_70406e3f5eda["WorkspaceView"] {
  <<component>>
}
click N_70406e3f5eda href "WorkspaceView.tsx"
class N_5630b8533f8a["ModuleSourceTree"] {
  <<component>>
}
click N_5630b8533f8a href "ModuleSourceTree.tsx"
N_86f28732d67f ..> N_5b41e4ed1e4d : 依赖
N_70406e3f5eda ..> N_12e22f6e4ffe : 依赖
N_70406e3f5eda ..> N_5630b8533f8a : 依赖
N_12e22f6e4ffe ..> N_86f28732d67f : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
