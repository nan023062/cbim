# 桌面引擎管理入口

主 Frame 的 desktop.engines.status 返回无路径目录；desktop.engines.prepare 仅接受严格枚举 engine，不能指定下载地址或命令。安装应用期间拒绝准备；用户点击准备后不启动模型、不选择引擎。Codex 准备同时保证其 Pi 原生工具依赖，失败保留各自真实状态。旧宿主缺端口明确拒绝，开发态标记 bundled。

桌面 Main 将冷壳 engineArtifacts 窄端口交给 Application；冷壳不再承担引擎活动选择，正式主/成员由 Application 的包管理服务固定版本。

## 内置运行资源边界

桌面 Application 读取当前 R 的 assets，开发态读取仓库 assets；不再从 design 注入运行规则。
