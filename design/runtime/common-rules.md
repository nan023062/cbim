# MCP 执行与治理通用规范

CBIM 是面向 AI 原生团队的生产与治理体系。创作与执行者对成果负责，核心治理者对体系健康与可持续性负责。知识与能力定义不授予权限，遵循宿主更高优先级规则及用户授权。

## 查询与流程

先 tools/list、cbim_workspace_identity 核对能力与身份。内置 cbim_skill_* 工具返回流程正文，宿主负责执行；cbim_builtin_catalog/cbim_builtin_read 返回清单、正文、内容版本与已解析 references。内置资料只读，available 引用按返回 id 继续读取，unavailable 引用记录缺口，不读取安装路径。

cbim_module_registry → cbim_module_get 返回模块知识与本模块 Workflow；cbim_agent_registry、cbim_people_list → cbim_agent_get 返回团队、真人、Agent 原则与自身及全部祖先 Skill。cbim_knowledge_search 补查，cbim_knowledge_snapshot 返回完整知识与检查结果。查询基于当前定义派生；定义无效时问题清单必须与结果一起考虑，不能把被校验排除的对象当作不存在的业务事实。

## CBIM 全权管理知识

宿主禁止直接读写、扫描或通过 shell、脚本、其他文件 MCP 访问 .cbim/。启动流程已直接嵌入 AGENTS.md、CLAUDE.md，不需要读取 entry 镜像。ignore、Hook 与权限配置仅作为辅助防护，不构成绕过授权。

对象增删改走 cbim_object_preview → cbim_object_commit。创建提供 parentId、slug、data、body；更新和删除提供查询返回 id。服务规划路径、方法清单、父子关系与索引。Skill 的 parentId 是 Team/小组或 Agent，Workflow 的 parentId 是 Module。删除含子对象需显式 cascade；非知识资源不由对象文本事务删除。

预览返回 planId、diff 与校验结果，不写正式知识。提交必须满足用户授权、桌面 Agent 写入开关与有效写凭据；校验不通过不能提交。版本冲突重新查询及预览，同一计划提交幂等。不能直接编辑文件绕过失败。

cbim_knowledge_preview/cbim_knowledge_commit 保留为文件级受控事务，修改现有内容使用服务返回的 path、revision；entry、project.json、派生注册表不可手工写入。知识维护需要移动可用 cbim_knowledge_move_preview。缺少创建位置规划的其他对象记录接口缺口，不猜路径。

cbim_knowledge_refresh 只检查当前知识并刷新派生注册表，用于外部人类变更后的同步，不是宿主绕过 CRUD 的入口。结构校验不能替代语义、专业质量或架构审批。

## 结构与缺口

team 根是 Team，中间节点是小组，叶子是 Agent；可用 Skill 来自自身与全部祖先，冲突不自动覆盖。workspace 为根，一级 Module 为领域工程，其下为模块；Workflow 只归当前模块。

缺失能力先查清单，再记录操作、影响与可继续步骤。没有业务记录接口时保留宿主任务记录并注明未写入 CBIM。不要运行旧 Python 规则工具。内置参考文档提及磁盘文件和脚本不授权宿主直接执行；以当前 MCP 协议为准。
