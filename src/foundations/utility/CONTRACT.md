# 通用算法与数据结构

本模块提供领域无关的数据处理算法、传入字节流的有界消费及实例内执行结构，不依赖 Core、Main、Scheduler、Bridge、Frontend 或其他 foundations 能力。每项能力独立实现、具名导出，不建立万能 Utility 类、全局实例或服务定位器。不发起文件/网络访问，不拥有平台进程、权限和业务事务；流消费者只接管调用者传入流的 reader。

## 入口与真实消费者

- `index.ts`：公开 `SerialQueue`、`formatJson`、`readBoundedBytes`/`ByteLimitError`、`parseStrictJson`/`StrictJsonError`；使用语言/Web Streams 原语和 jsonc-parser，没有 Node 加载。
- `node.ts`：公开 `sha256`，仅依赖 `node:crypto`；调用者明确选择运行环境。
- `serial-queue.ts`、`json-text.ts`、`digest.ts`、`bounded-bytes.ts`、`strict-json.ts` 是私有实现，消费者只导入上述公开入口。
- WebSettings、BudgetSettings、AdmissionSettings、MainAgentSettings、LlmProfiles 直接组合 SerialQueue。旧 `foundations/concurrency` 目录及入口已移除。
- Core `foundation/serialization.ts` 保留 `hash/json` 名称兼容，直接重导出 utility 的算法；实现只有一份。现有知识版本、证据及配置消费者保持原调用和输出字节。该适配出口尚未退役，后续迁移须核对其真实消费者及逻辑边界，不机械批量改路径。
- Core `foundation/json.ts` 只将 StrictJsonError 转回原 JSON Fault；知识与产物验证保留原提示、字段和限制。Main 的资源仓库、GitHub 请求、网页资料，以及 Updater 的 Release 列表和小清单组合有界字节消费；URL、凭据、期限、编码、JSON 协议和错误脱敏仍由消费者负责。

## SerialQueue

每实例独立持有 Promise 尾链，同实例按 run 提交顺序串行执行。本次结果或错误原样返回，同步抛错、异步拒绝均不阻断后续任务；无重试、取消或自动关闭。

`drain` 只等待调用时的队尾，不汇总错误、不封闭队列；错误由各次 run 的调用者处理。任务内等待同队列的后续任务会自锁，禁止重入等待。业务 revision、模型短锁、当前工作区验证、写后发布顺序仍归消费者。RunJournal、IsolationRecords 的失败屏障不能用此队列替换。

## 数据算法

`formatJson` 保持原两空格缩进、末尾 LF 和 JSON.stringify 的属性顺序/异常行为；不做严格 JSON 解析或规范排序。顶层 undefined、函数、Symbol 沿兼容行为形成 `undefined\n`，不能作为有效 JSON 输入使用。调用者负责约束值，不能在抽取中暗改历史文本或指纹。

`sha256` 接受 UTF-8 字符串或 Uint8Array（含 Buffer），返回小写十六进制；字节视图不扩大到背后的整个 ArrayBuffer。业务选择哪些字段、如何序列化、是否接受摘要仍在原模块；该算法不承担验签或可信来源判断。

## 扩展与验证

### 有界字节流

`readBoundedBytes(body, {maxBytes, signal})` 仅完整成功时返回 Uint8Array。maxBytes 为非负安全整数，按字节累计，不相信 Content-Length；超限抛 ByteLimitError，流错误与 signal.reason 原样传出，null 正文为空。非法上限/预先取消在取得 reader 前拒绝，流仍由调用者持有；已接管后，失败请求一次 cancel，正常或失败均移除监听并释放 reader 锁。

取消显式唤醒挂起 read，且不等待不合作的底层 cancel Promise，避免取消自己再次挂起；清理失败不覆盖原错误。这证明本次读取不再等待，不证明网络/进程物理退出，相关屏障仍归原宿主。分块按可见视图显式复制（含 Buffer），生产者后续复用存储不改变已读取字节；最终合并的内存与字节上限同阶，不返回截断前缀。大安装包流式落盘、模型字符上限、Node 原始 HTTP 传输及其他协议不强行套用该内存收集器。

### 严格 JSON

`parseStrictJson` 保留原 jsonc-parser 行为，拒绝注释、尾逗号、无效语法和同对象重复键；转义后同名也重复，不同对象可以有同名键。StrictJsonError 分别给出 invalid-syntax、duplicate-key 与重复 key，不包含业务 code。

解析不进行危险键裁剪、Schema 校验、字段排序或大小/深度限制；资源预算、原字节身份与错误对外映射由消费者决定。远端 HTTP 的普通 JSON 解码未擅自改成严格解析，避免改变已有协议。

### 扩展入口

新增算法或数据结构须先给出真实用途、状态归属、输入输出、复杂度及失败语义；标准库已足够时直接使用，不为预想需求添加集合、缓存或调度框架。功能按职责拆文件，公共入口只做导出；通用入口不得导入 Node 入口。

模块单元在 `tests/unit/foundations/utility/`，按队列、格式化、摘要、严格 JSON、字节流分别验证；Core 名称/字节/错误兼容与流消费业务映射另做契约测试。模块测试不加载 Application；消费者保留真实 HTTP 取消/超时、资料快照、知识校验、版本冲突和原指纹规则。
