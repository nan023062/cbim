# 模型配置服务

公开入口为 index.ts，唯一实现 LlmProfiles 拥有本机供应商配置、encryptedKey 和实例 SerialQueue。纯模型规则通过上层 index.ts 组合；文件替换使用 Core Node files，错误使用 Core Fault。平台加密实现由宿主注入 SecretCipher，不反向引用旧 Main。

save/select/remove 串行写入配置；withConfigurations 与 withRuntimeConfiguration 在同一队列固定配置，回调内不得再次进入队列。后者仅在回调有效期内允许解析已捕获凭据，退出后 resolve 拒绝。预算和占用检查仍由调用方负责，锁释放后才启动引擎。

configuration/resolve/test 接受可选 ModelConnectionRequirement，缺省使用供应商主接口，不识别引擎 ID；不兼容返回 LLM_CONNECTION_API。EngineModelProfiles 在外层生成需求、组合引擎快照并保留执行侧 LLM_ENGINE_API 诊断。configuration 与公开目录不解密、不联网；resolve 及受控锁内 resolve 才解析凭据。公开列表仅返回 hasKey。运行快照不携带备用地址或预设来源，设置变化不热替换已捕获快照。

主接口变更或新增自定义凭据目标必须重新提供 Key，改名/型号范围/删除兼容接口保持原规则。探测固定选中的接口，失败不切换协议、不重发或清空目录。错误仅返回安全端点和状态，不返回上游正文、密钥或查询参数。

现有文件格式、默认选择、原子写入与失败语义保持；迁移不重写用户文件。测试使用独立临时目录和加密替身，不加载完整 Application。下一次修改配置并发、保存或探测从 llm-profiles.ts 入手。
