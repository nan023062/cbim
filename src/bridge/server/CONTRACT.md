# 桌面宿主与业务应用适配

## Application 的设计意图

[application.ts](application.ts) 中的 `Application` 是 Logic Application 的实例适配子类，只增加 `dispatch`，沿用父类的全部业务状态、构造和关闭行为。继承用于让桌面调用方继续持有同一个应用对象，不通过重载生命周期建立第二份服务集合。

三个连续声明分别是已知操作的配对响应签名、动态字符串的 unknown 响应签名和实际分派实现。全部请求委托 [IPC 分派器](ipc/dispatch.ts) 做解析及业务路由；解析或业务异常原样传播，适配器不授予额外权限。新增操作修改通信契约及对应处理器，普通业务服务不依赖本子类。

## 桌面引擎管理入口

主 Frame 的 desktop.engines.status 返回无路径目录；desktop.engines.prepare 仅接受严格枚举 engine，不能指定下载地址或命令。安装应用期间拒绝准备；用户点击准备后不启动模型、不选择引擎。Codex 准备同时保证其 Pi 原生工具依赖，失败保留各自真实状态。旧宿主缺端口明确拒绝，开发态标记 bundled。

桌面 Main 将冷壳 engineArtifacts 窄端口交给 Application；冷壳不再承担引擎活动选择，正式主/成员由 Application 的包管理服务固定版本。

## 内置运行资源边界

桌面 Application 读取当前 R 的 assets，开发态读取仓库 assets；不再从 design 注入运行规则。
