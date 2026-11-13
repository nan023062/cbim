# Node 摘要与文件

单文件 I/O 通过 [files/index.ts](files/index.ts) 使用，契约见 [files](files/CONTRACT.md)。模型服务与旧存储适配直接组合此入口，不能穿透 text-files.ts；没有旧路径转发。文件原子替换不承担业务事务或跨进程锁。

摘要公开入口为 digest.ts 的 sha256：字符串按 UTF-8、字节视图按可见范围计算 SHA-256，返回小写十六进制。仅依赖 node:crypto，无文件或网络副作用。

原 backend/core/foundation/serialization.ts 的 hash 名称仍单向重导出此实现，历史知识版本和指纹字节保持。Node 摘要不经 core/utility 导出，View/前端/桥接客户端不得导入。现阶段引擎、调度器、更新器也不因新增 Core 而扩大原依赖许可。

独立单元仍在 tests/unit/foundations/utility/digest.test.ts，模块归属为 core/platform/node。字段选择、序列化顺序、授权或验签决定不属于摘要算法。

## 原生互斥锁

locking.ts 提供 KernelLock，使用 Windows mutex 或 POSIX flock。保留 Global\\CBIM 命名、scope/id 键、错误与进程内 held 集合；创建目录、重试、事务顺序与释放时机由消费者决定。旧 Main/platform/locking.ts 仍有工作区、资源和执行消费者，重导出同一构造器，不能保留第二份实现。koffi 只按固定安装包或 node_modules 路径加载；便携 Core 和前端不得导入。
