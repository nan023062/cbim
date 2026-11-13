### Brave 搜索配置

WebSettings 使用 revision 校验并串行原子保存浏览器 robots 策略、搜索开关与系统加密密钥；无安全加密端口时拒绝保存/使用密钥，不明文回退。移除密钥同时关闭搜索，密钥读取只返回 hasKey。主进程网络适配器是 resolve 的唯一生产消费者；配置修改不触发搜索或模型请求。

browserRobotsPolicy 为 allow/respect；新配置和缺少字段的旧文件默认 allow。旧客户端保存省略此字段时保留当前值，不重置为默认。策略不依赖 Brave 密钥或安全存储；WebService 每次读取捕获已保存策略，正在执行的读取不被中途改写。

# 本机设置持久化边界

`LlmProfiles` 管理供应商和模型配置，凭据通过平台注入的加密接口保存，运行时才解密。`AdmissionSettings` 独立管理全局执行并发配置，不能读取或修改模型凭据。

`configuration(profileId,modelId,engine?)` 供岗位登记读取明确选定的公开模型快照，与真实运行共用同一纯选型函数。必须给出两个标识，不使用默认选择，不解密、不调用网络；无供应商、缺模型或禁用模型会拒绝。输出只包含实际运行公开 profile 字段，不含 apiKey、encryptedKey、hasKey 或默认选择。配置可读不代表凭据有效或模型可执行。

`withConfigurations` 在与 save/remove/select 相同的队列中一次固定多岗位公开配置，供 Knowledge → 模型配置 → DispatchStore 的短事务使用。`withRuntimeConfiguration` 另提供限回调期间使用的 resolve，预算和占用通过后只解密该已捕获定义，不读盘、不重新排队、不联网。领取提交后放锁，真正引擎沿原闭包启动；后来的配置修改不热替换已领取运行。凭据不进入任务、绑定、公开指纹或运行日志。

并发设置文件只保存 `version:1` 与 `policy:{revision,maxConcurrentRuns}`。默认 4，允许 1～32；应用在打开工作区前初始化一次，缺文件使用默认值，损坏文件明确失败而不覆盖。`read()` 只读已生效策略，`configure()` 用原版本串行校验，原子写盘成功后同步交给准入器。写入失败保持原限额，版本冲突要求刷新；降低上限不结束现有执行。

`BudgetSettings` 独立保存新周期默认软限额 `version:1 + policy:{revision,enabled,limits}`。默认关闭，启用须明确正整数 Token 或正数估算美元；应用装配前恢复，只有缺文件可默认关闭。损坏配置明确失败；串行版本校验和原子写入通过后才更新内存，读取返回深拷贝。新周期冻结策略，已有周期不跟随设置改变，设置本身不保存或更改用量。

此目录不保存等待票据或执行许可。票据只属于当前进程的可信启动安排；重启不能通过设置文件自动恢复任务。并发数与周期软限额不同，后者仅在真实运行之间核实，不保证一次 Pi 内多个请求、重试和摘要的硬账单上限。

## 逐请求预算（R06）

额度策略新增显式 `enforcement: request`；字段缺省继续表示运行间软限额，相同配置判断包含模式。设置版本可靠原子保存，旧目标冻结策略不随全局修改。

### Agent 独立选型与历史兼容

显式连接测试失败返回安全端点（不含用户信息、查询串、片段）、HTTP 状态及鉴权/权限/端点/限流建议，不返回供应商错误正文；失败不写模型目录。模型 ID 不按品牌枚举转换，Claude Code 仅要求 Anthropic Messages 协议。

LlmProfiles 忽略旧供应商 engine，由调用方传入独立引擎，通过 connectionForEngine 选择主接口、明确的兼容接口或精确官方预设，再生成单一地址的公开快照；未传引擎不补 Pi 字段。配置细则见 [模型服务契约](../models/CONTRACT.md)。岗位读取沿已经采纳的 snapshot.engine，保证旧原生岗位和缺省 Pi 的配置哈希可核实。无效、禁用或不兼容的选择明确拒绝。

MainAgentSettings 为每个工作区的 cbim:main 保存唯一选型，复用自定义 Agent 的 AgentModelSelection 契约。对话栏和团队页面共享 read/configure，不再把选型存入会话 localStorage；内置主 Agent 的能力文件不因此可编辑。文件保存 version、revision、selection，null 采用 Pi 与本机默认模型。configure 在当前实例和 revision 校验后持有模型短锁原子写盘；读写失败保留原文件，版本冲突不得自动覆盖。配置本身不触发执行，新发送冻结配置，已受理队列和运行保持原快照。

## 机制与业务分离

`WebSettings` / `BudgetSettings` / `AdmissionSettings` 各自拥有 `core/utility` 的 `SerialQueue`；一次保存失败向该调用者抛出，队列继续受理后续操作。`backend/core/foundation/files` 提供同目录临时文件替换，版本校验、密钥加解密、字段兼容和默认策略仍由各设置类决定。队列不跨实例或跨进程互斥，也不提供事务回滚。

模块单元直接创建设置服务与临时目录，不加载 Application；IPC 契约与应用装配验证独立保留，避免保存规则的修改迫使单元夹具启动完整应用。
