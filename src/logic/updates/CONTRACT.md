### 引擎准备与应用更新分离

EngineArtifactsPort 的 prepare 接受可选进度回调，报告准备过程但不授予安装或运行许可；选择及短期进度由 Logic/engines 的包管理服务拥有。旧冷宿主可忽略回调，调用结果与错误语义不变。

DesktopUpdateStatus.enginePreparations 仅保留旧冷宿主兼容，不再由应用更新界面消费；引擎状态通过 engines.settings 展示。具体支持清单仍随 R 静态代码提供，冷框架不登记厂商引擎。
