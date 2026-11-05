# Python → TypeScript 规则迁移

按用户要求，新应用不复用 Python 进程。`src/main/knowledge.ts` 与现有 Schema 是新运行权威，旧 Python 与旧 Skill 脚本暂留作历史对照，不由 UI、CLI、MCP 调用，日后废弃。

| 原实现/规范 | 新实现 |
|---|---|
| maintain_registries.py | AJV、重复字段、摘要、作者、连接器和派生注册表 |
| validate_flat_module | id、名称、children、五章节、classDiagram、Workflow |
| team_skills.py | Team 树、专属/共享方法、全部祖先链、冲突与来源 |
| check_module_sources.py | 路径安全、文件夹、重复、祖先包含及跨分支警告 |
| preview_module_tree.py | React 模块树、搜索、展开折叠、字号缩放、虚拟节点 |
| skill_runtime.py | 统一 Paths 与用户级本地记录 |
| file_baseline.py 的写入基线需求 | 内容哈希、事务 before/after 与恢复 |

有意差异：空团队/模块合法；已有文件不能作为 source；尚不存在目录提示核实；落实 snake_case 与虚拟节点标记；补充常见 Markdown 引用检查；所有新本地运行数据改为用户级目录。诊断不会自动改写已有架构事实。

未迁移为自动执行功能：源码全量游离文件扫描、自动改写模块类图、旧 core 文档依赖扫描、AI 语义生成摘要、Workflow/Skill 专用创建向导。首版通过通用批量知识事务创建和维护正式对象，不将专用旧脚本宣称为已迁移。

类图语义、scope 自然语言维护边界、职责与业务运行仍需团队 review。自动结构检查不等于架构正确。新的测试运行真实 TypeScript 服务，不用 Python 替身证明能力。
