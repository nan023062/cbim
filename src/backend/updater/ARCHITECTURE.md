# src/backend/updater 架构

## 目录定位

独立桌面更新子系统：公开 Release 读取、稳定版本筛选、每分钟检查及用户发起的下载/自动安装状态机和 NSIS 适配均在此目录。只依赖公开更新契约及系统/第三方库，不导入 main、scheduler-engine 或 core/runtime；通过关闭回调等待主程序排空。安装包缓存独立于运行数据。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [desktop-releases.ts](desktop-releases.ts) | 读取固定 GitHub 仓库中独立 desktop-v 通道的公开稳定发布。 |
| [desktop-updates.ts](desktop-updates.ts) | 桌面更新的单实例状态机，每分钟检查，用户下载后串联校验、业务排空和重启安装。 |
| [nsis-updater.ts](nsis-updater.ts) | electron-updater 的 Windows NSIS 适配，只消费已选择的固定桌面发布。 |
| [release-http.ts](release-http.ts) | 更新子系统读取公开 Release 列表的独立 HTTP 边界。 |
| [restart-profile.ts](restart-profile.ts) | 恢复安装器显式传回的本机用户目录，供 Main 在初始化任何业务数据之前调用。 |

## 架构类图

### desktop-releases.ts

```mermaid
classDiagram
class N_src_backend_updater_desktop_releases_ts["desktop-releases.ts"] {
  <<module>>
  +compareDesktopVersions()
  +desktopInstallerName()
  +desktopReleaseBase()
  +parseDesktopRelease()
  +latestDesktopRelease()
}
```

直接依赖：[../../bridge/contracts/desktop-updates.ts](../../bridge/contracts/desktop-updates.ts)、[release-http.ts](release-http.ts)。

### desktop-updates.ts

```mermaid
classDiagram
class N_src_backend_updater_desktop_updates_ts["desktop-updates.ts"] {
  <<module>>
}
class N_src_backend_updater_desktop_updates_ts_DesktopUpdateInstaller["DesktopUpdateInstaller"] {
  <<interface>>
  +prepare()
  +download()
  +install()
  +close()
}
N_src_backend_updater_desktop_updates_ts ..> N_src_backend_updater_desktop_updates_ts_DesktopUpdateInstaller : 声明
class N_src_backend_updater_desktop_updates_ts_DesktopUpdates["DesktopUpdates"] {
  +status()
  +start()
  +check()
  +download()
  +install()
  +close()
  -latest
  -installer
  -beforeInstall
  -state
  -busy
  -controller
  -timer
  -initial
  -run()
  -installReady()
}
N_src_backend_updater_desktop_updates_ts ..> N_src_backend_updater_desktop_updates_ts_DesktopUpdates : 声明
```

直接依赖：[../../bridge/contracts/desktop-updates.ts](../../bridge/contracts/desktop-updates.ts)、[desktop-releases.ts](desktop-releases.ts)。

### nsis-updater.ts

```mermaid
classDiagram
class N_src_backend_updater_nsis_updater_ts["nsis-updater.ts"] {
  <<module>>
}
class N_src_backend_updater_nsis_updater_ts_NsisUpdateInstaller["NsisUpdateInstaller"] {
  +prepare()
  +download()
  +install()
  +close()
  -updater
  -pending
  -error
  -closed
  -downloaded
}
N_src_backend_updater_nsis_updater_ts ..> N_src_backend_updater_nsis_updater_ts_NsisUpdateInstaller : 声明
class N_src_backend_updater_nsis_updater_ts_external_DesktopUpdateInstaller["DesktopUpdateInstaller (外部契约)"] {
  <<external>>
}
N_src_backend_updater_nsis_updater_ts_external_DesktopUpdateInstaller <|.. N_src_backend_updater_nsis_updater_ts_NsisUpdateInstaller
```

直接依赖：[../../bridge/contracts/desktop-updates.ts](../../bridge/contracts/desktop-updates.ts)、[desktop-updates.ts](desktop-updates.ts)、[desktop-releases.ts](desktop-releases.ts)。

### release-http.ts

```mermaid
classDiagram
class N_src_backend_updater_release_http_ts["release-http.ts"] {
  <<module>>
  +releaseRequest()
}
```

```mermaid
classDiagram
class N_src_backend_updater_release_http_ts["release-http.ts"] {
  <<module>>
}
class N_src_backend_updater_release_http_ts_ReleaseRequest["ReleaseRequest"] {
  <<type>>

}
N_src_backend_updater_release_http_ts ..> N_src_backend_updater_release_http_ts_ReleaseRequest : 声明
```


### restart-profile.ts

```mermaid
classDiagram
class N_src_backend_updater_restart_profile_ts["restart-profile.ts"] {
  <<module>>
  +updateUserRoot()
}
```


### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_updater_desktop_releases_ts["desktop-releases.ts"] {
  <<module>>
}
class N_src_backend_updater_release_http_ts["release-http.ts"] {
  <<module>>
}
class N_src_backend_updater_desktop_updates_ts["desktop-updates.ts"] {
  <<module>>
}
class N_src_backend_updater_nsis_updater_ts["nsis-updater.ts"] {
  <<module>>
}
N_src_backend_updater_desktop_releases_ts ..> N_src_backend_updater_release_http_ts : 导入依赖
N_src_backend_updater_desktop_updates_ts ..> N_src_backend_updater_desktop_releases_ts : 导入依赖
N_src_backend_updater_nsis_updater_ts ..> N_src_backend_updater_desktop_updates_ts : 导入依赖
N_src_backend_updater_nsis_updater_ts ..> N_src_backend_updater_desktop_releases_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# 桌面更新子系统

更新程序集中于本目录，与 main 的业务资源、scheduler-engine 及 core/runtime 分离。只依赖公开 `DesktopUpdateStatus` / `DesktopRelease` 契约、系统和第三方库；Main 负责启动、固定 IPC 和业务关闭回调，不向本模块暴露工作区、模型或反馈 Token。

`release-http` 只读固定公开 GitHub Release 列表，不附凭据、不重定向，单请求 20 秒、响应 2 MiB。`desktop-releases` 只接受 `nan023062/cbim` 的 `desktop-vX.Y.Z` 稳定版本、匹配的 Windows x64 安装包及清单；不消费旧 Python 内核 v1.x。检查失败明确报告，不以空列表冒充当前已是最新版。

`DesktopUpdates` 在正式安装版启动后 10 秒检查，定时器每 60 秒触发；在途操作合并，检查不下载。失败保留已知新版与本次完成时间，仅在更新页显示错误，下一分钟重新检查；不弹全局错误。checkedAt 是最近完成检查的时间，失败也记录，不能据此声称已联网成功。

用户点击下载已包含随后的安装重启授权：同一后端在途操作先核清单、下载并校验，再公开 installing 两秒让窗口展示进度，随后调用 Main 注入的正常关闭回调；只在排空成功后调用安装器。候选在下载／安装期间冻结，弹窗关闭或 IPC 回包丢失不触发第二次安装。下载失败回到 available；排空／安装失败停在 ready，保留缓存，只能明确重试 install，不由计时器或普通退出重放。

Main 的普通退出在开始排空前 close 更新服务；提示阶段、下载中或排空中迟到的结果不能继续安装。close 清除计时器并禁用本进程的更新动作；如果普通关闭失败保留窗口，明确提示需重新启动以恢复检查。已授权安装由成功排空后的 quitting 标识与普通退出区分；缓存不会在新进程启动时自动安装。

`NsisUpdateInstaller` 重新核对 `latest.yml` 的准确版本、唯一安装文件名及 SHA-512，关闭自动下载、退出自动安装、预发布、降级和网络安装器。首版未配置发布者证书，不宣称通过签名校验。固定 HTTPS 发布及清单负责来源与完整性，下载完成不代表升级完成。

安装包产物位于仓库 `build/desktop-release/<version>/`；用户下载缓存位于 `%LOCALAPPDATA%/cbim-desktop-updater/`，与安装程序目录、用户 `~/.cbim` 及业务工作区分开。缓存不会在启动或退出时自动安装。

`restart-profile` 在 Main 初始化之前核对重启目录。`packaging/updater/` 中的 NSIS 启动模板将原进程明确配置的 `CBIM_USER_DATA_ROOT` 作为更新重启参数传回，解决 Windows Shell 不继承环境的问题；只传目录、不传凭据，正常安装沿用默认目录。重复、相对、带引号／控制字符或超长参数直接拒绝，不静默打开默认用户数据。
