# 新版业务层

## 设计意图

为当前桌面视图提供业务用例。迁移范围沿新版入口追踪到具体调用和所需契约；历史功能留在旧目录，待产品接入时逐项迁移。

## 主要组成

Application 负责生命周期。项目、设置、用户、更新、资源管理和运行监控面向桌面功能。Office 对话使用已安装的引擎包和用户选择的模型；引擎包管理、模型配置和下载队列为这些入口提供服务。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

### 关系组 1：application

```mermaid
classDiagram
class N_353719356734["application"] {
  <<virtual>>
}
click N_353719356734 href "application/ARCHITECTURE.md"
class N_105eef4f3348["monitor"] {
  <<virtual>>
}
click N_105eef4f3348 href "monitor/ARCHITECTURE.md"
class N_70d503980bba["projects"] {
  <<virtual>>
}
click N_70d503980bba href "projects/ARCHITECTURE.md"
class N_d91567a60d08["resource-management"] {
  <<virtual>>
}
click N_d91567a60d08 href "resource-management/ARCHITECTURE.md"
class N_6a083dde6711["settings"] {
  <<virtual>>
}
click N_6a083dde6711 href "settings/ARCHITECTURE.md"
class N_0adbfaa2201b["updates"] {
  <<virtual>>
}
click N_0adbfaa2201b href "updates/ARCHITECTURE.md"
N_353719356734 ..> N_105eef4f3348 : 依赖
N_353719356734 ..> N_70d503980bba : 依赖
N_353719356734 ..> N_d91567a60d08 : 依赖
```

### 关系组 2：user

```mermaid
classDiagram
class N_2336517adaa7["user"] {
  <<virtual>>
}
click N_2336517adaa7 href "user/ARCHITECTURE.md"
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [application](application/ARCHITECTURE.md) | 负责应用生命周期。 |
| [monitor](monitor/ARCHITECTURE.md) | 负责运行监控。 |
| [projects](projects/ARCHITECTURE.md) | 负责项目列表和各项目的 Office 会话。 |
| [resource-management](resource-management/ARCHITECTURE.md) | 负责主菜单资源管理。 |
| [settings](settings/ARCHITECTURE.md) | 负责应用设置。 |
| [updates](updates/ARCHITECTURE.md) | 负责应用内的更新操作。 |
| [user](user/ARCHITECTURE.md) | 负责用户账号。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
