# src/logic/updates/service 架构

<a id="contract"></a>

## 设计意图

实现独立于普通业务的版本发现、制品准备、激活与恢复，保护用户数据和原运行选择。

`DesktopUpdates` 与 `NsisUpdateInstaller` 管理安装通道，`RuntimeUpdates` 组合资源存储和激活日志，`EngineArtifacts` 提供签名引擎制品，固定运行包解析由 [EnginePackages](../../../resource/engines/ARCHITECTURE.md) 承担。后台准备不改变活动版本；明确应用后等待业务关闭，恢复依据原日志与数据访问阶段。

安装适配由独立的 [Updater](../../../updater/ARCHITECTURE.md) 提供，属于外部协作边界，不是本目录实现。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [DesktopUpdates](desktop-updates.ts) | 桌面更新的单实例状态机，后台检查并预下载，用户确认后才排空业务和重启安装。 |
| [EngineArtifacts](engine-artifacts.ts) | 冷壳持有的通用 E 制品服务，保存独立签名索引历史并准备准确摘要的包。 |
| [RuntimeJournal](runtime-journal.ts) | 冷壳拥有的资源激活日志；区分准备缓存、用户授权、原数据访问和已确认启动。 |
| [RuntimeStore](runtime-store.ts) | 管理资源 / 引擎不可变版本目录及其签名清单；后台准备不修改活动选择。 |
| [RuntimeUpdates](runtime-updates.ts) | 连接 C 安装通道与同 C 的 R 资源通道，准备候选并在业务排空后记录显式切换。 |

| [DownloadService](download-service.ts) | 队列由桌面宿主持有；清单选择、解包和激活由上层管理。 |

<!-- architecture:generated:start -->

## 架构关系

### 关系组 1：RuntimeStore

```mermaid
classDiagram
class N_8fa06dc8085b["RuntimeStore"]
click N_8fa06dc8085b href "runtime-store.ts"
class N_6575f81306a7["EngineArtifacts"]
click N_6575f81306a7 href "engine-artifacts.ts"
class N_ad8b65940f11["DownloadService"]
click N_ad8b65940f11 href "download-service.ts"
class N_8ee0c4c2ec64["RuntimeUpdates"]
click N_8ee0c4c2ec64 href "runtime-updates.ts"
class N_715401df109b["EngineArtifactsPort"] {
  <<boundary>>
}
click N_715401df109b href "../engine-artifacts.ts"
class N_e8ce47c6febe["RuntimeJournal"]
click N_e8ce47c6febe href "runtime-journal.ts"
N_6575f81306a7 ..> N_8fa06dc8085b : 依赖
N_715401df109b <|.. N_6575f81306a7
N_8fa06dc8085b ..> N_ad8b65940f11 : 依赖
N_8ee0c4c2ec64 ..> N_8fa06dc8085b : 依赖
N_8ee0c4c2ec64 ..> N_e8ce47c6febe : 依赖
```

### 关系组 2：DesktopUpdateInstaller

```mermaid
classDiagram
class N_e707e61e3773["DesktopUpdateInstaller"] {
  <<boundary>>
}
click N_e707e61e3773 href "desktop-updates.ts"
class N_79639799d131["DesktopUpdates"]
click N_79639799d131 href "desktop-updates.ts"
```

### 跨图协作

按引用方归并目标，保留全部跨图关系；分图只用于阅读，不表示新增模块或依赖边界。

| 引用方 | 关系 | 目标 |
| --- | --- | --- |
| [RuntimeUpdates](runtime-updates.ts)（图 1） | 实现 | [DesktopUpdateInstaller](desktop-updates.ts)（图 2） |

外部继承／实现边界：[EngineArtifactsPort](../engine-artifacts.ts)、[DesktopUpdateInstaller](desktop-updates.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
