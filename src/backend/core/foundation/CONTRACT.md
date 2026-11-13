# 旧后端领域约定

本目录只保留 identity、paths、JSON 错误适配及 hash/json 兼容出口。errors.ts 重导出共享 Core Fault，旧调用者仍使用同一个构造器。utility、文件和网页基础机制已迁出；新 Logic 直接消费共享 Core，不依赖本目录。

通用入口见 [utility](../../../core/utility/CONTRACT.md)、[文件](../../../core/platform/node/files/CONTRACT.md)、[网页](../../../core/platform/node/web/CONTRACT.md)。路径权限、工作区身份、事务、历史指纹和错误码策略继续归业务所有。
