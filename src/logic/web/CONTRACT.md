# Web 业务边界

index.ts 只公开工具输入输出、设置输入及摘要类型，不加载 service 或平台。service/index.ts 向宿主公开 WebService 与 WebSettings；Logic 工具编排仅消费纯工具契约。业务模块不依赖 Bridge 或 View。

工具注册、运行权限仍由调度器拥有；WebService 只组合 Core 读取器并标注 untrusted，搜索固定 Brave API。WebSettings 保存 revision、搜索开关、加密密钥和浏览器 robots 策略。

bridge/contracts/web.ts 是已登记的具名设置契约出口，只公开 webConfigureInput 与 WebSettingsView。IPC 操作名和字段保持，不开放工具执行、服务实例或密钥端口；如后续独立通信 DTO，需同步替换实际消费者后再退出此兼容许可。

修改 robots/搜索业务配置进入 [service](service/CONTRACT.md)，修改抓取和浏览器机制进入 [Core 网页](../../core/platform/node/web/CONTRACT.md)。
