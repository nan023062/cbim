# 主菜单资源管理

## 设计意图

负责主菜单资源管理。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ResourceManagement](index.ts) | 为发现页查询已签名插件目录，按人才与业务分类读取仓库。 |

| [PluginInstallations](plugin-installations.ts) | 保存用户安装意图，重启后按签名目录核验并恢复插件。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_57e27ba95707["PluginInstallations"]
click N_57e27ba95707 href "plugin-installations.ts"
class N_57b4c095d27d["ResourceManagement"]
click N_57b4c095d27d href "index.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
