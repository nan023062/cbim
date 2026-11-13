# 模型配置与接口解析

## 通用机制与模型决策

`LlmProfiles` 与 `MainAgentSettings` 分别拥有 `backend/core/foundation/utility` 的 `SerialQueue`，组合 `backend/core/foundation/files` 进行文件替换。串行执行与临时文件清理是基础机制；选型校验、历史快照兼容、密钥、revision 和锁内解析仍由模型服务持有。调用者能观察本次失败，后续任务继续排队；不改变现有回调期间持锁范围，不引入跨实例互斥或自动重试。

LlmProfiles 持有供应商目录与唯一 encryptedKey；Core 的 connectionForEngine 只做公开接口投影。configuration、withConfigurations、withRuntimeConfiguration 与 resolve 在同一选型入口核实型号、启用状态和目标引擎接口，再形成不带候选地址的单次运行快照。只有 resolve 或受控锁内 resolve 解密，选择模型或读取目录不联网。

主接口改动及新增/更改自定义兼容地址时，保存必须重新输入 Key；仅改名、改型号范围或移除兼容接口可保留已保存密钥。自动识别只匹配 provider-presets 的精确官方地址，旧文件无需迁移或复制供应商，特殊套餐、地区及代理不会被品牌名覆盖。实际请求固定选中的地址，失败不切换协议、不重发，也不删除目录。

test(id, modelId?, engine?) 与运行共用解析，省略引擎保持原主接口。它只向已保存接口发送短文本，回执带实际引擎、协议、地址和耗时；错误仅提供安全地址、HTTP 状态与建议，不公开上游正文。测试不保存“全能力兼容”状态，不证明真实引擎工具、流式、额度或业务验收。设置队列、岗位配置锁与延迟解密的生命周期保持原有规则。
