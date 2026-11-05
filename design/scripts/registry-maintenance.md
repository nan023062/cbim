# 注册表维护与校验规范

维护定义和索引、执行校验或处理写入中断时按需读取。本规范由调用方提供给任务，不要求加载整个工具目录。

## Core 依赖方向校验

```powershell
python design/scripts/check_core_dependencies.py --root "<工程根>"
```

检查 design/skills、memory、task、business、capability、connector 下 Markdown 与 JSON 的显式本地引用：仅允许 `skills → task → business / capability → connector` 和独立分支 `memory → task`。Memory 由入口装配，Task、Skill 和其他抽象不得反向依赖 Memory；Memory 不直接依赖 Skill、business、capability 或 connector。同层内部可引用自身文件，CBIM AI 助理 Skills 不得跨 Skill 互引；business 与 capability 不互引，connector 不反向依赖上层。上述抽象目录不得直接引用入口、docs 或 scripts；项目工具和资料由入口装配为任务上下文。Agent 定义中的专业 skills 清单不等于 CBIM AI 助理 Skills。

检查覆盖 Markdown 行内链接、引用式链接定义、HTML href/src、行内代码中的显式相对／项目路径及 JSON 的 $ref/$dynamicRef，同时检查目标文件存在。网络链接及同文件锚点不参与分层检查；动态引用、自然语言调用、章节锚点有效性仍需人工或其他工具复核。脚本不执行目标文件、不重写索引；失败返回非零退出码。

README 与 design/docs 只供人阅读，不作为执行依赖；面向人的导航可引用规范。同一命令检查 core、入口、team 和 workspace 的执行 Markdown/JSON，拒绝直接或经执行文档间接到达 README 或 design/docs 的显式引用链，路径大小写不敏感；人类文档自身不作为执行起点。JSON 的知识、工作原则、Skill、Workflow 与 Schema 引用字段同样检查；sources 是工作范围清单，不作为指令导入。纯文字说明禁止加载不作违规处理；自然语言隐式加载仍需人工复核。用户明确要求审查这些文档时，可作为任务对象读取，不将其变成执行规则。

原有注册表校验仍独立执行，不能用方向校验代替 Schema、作者、清单或摘要一致性校验。完整测试命令见文末。

## 模块自动注册排除规则

统一配置文件为项目中的 `.cbim/.cbimignore`，采用 .gitignore 语法；用途是阻止指定内容被模块系统自动登记，不是让 CBIM 对这些内容不可见。用户直接编辑该文件即可，不需要 JSON 或逐模块配置。文件缺失时没有自定义忽略规则；解析失败须明确报错，不能静默忽略整份配置。

**路径基准为项目根（包含 .cbim/ 的目录）**。这是 CBIM 的统一路径约定，虽然配置放在 .cbim/ 内，根锚定的 `/` 仍表示项目根。支持空行、`#` 注释、`*`、`?`、字符组、`**`、目录末尾 `/`、转义与 `!` 重新包含，按行顺序处理。先忽略父目录后，不能仅通过子文件的 `!` 规则绕过父目录，须先重新包含父目录。路径和规则按 CBIM 的跨平台标识约定不区分大小写（例如 *.meta 也匹配 .META）；这是固定的项目约定，不读取 Git 的 core.ignorecase 设置。

```gitignore
# 所有层级的 Unity 元数据
*.meta
# 忽略项目根下的特定生成目录
/Client/Generated/
# 不自动登记某个模块目录（仍可显式读取与分析）
/.cbim/workspace/example/
# 先忽略普通临时文件，再保留一个例外
*.tmp
!important.tmp
```

这些只是示例；当前配置仅启用 .meta 规则，不默认忽略其他工程目录或文件。

作用范围：

- 模块自动登记：过滤匹配的候选文件和目录，并保留排除记录；已有索引与候选集合不一致时报告差异，只有显式同步命令才重建派生索引。固有归档、隐藏目录、安全边界排除仍有效。AI 成员与团队不应用 .cbimignore。规则不触发文件删除、模块拆分或依赖解除。
- sources：先验证路径与 scope，再对忽略条目单独记账，不参与重复或包含比较。严格注册表校验拒绝显式登记被忽略的 source，要求从索引移除；并不因此删除磁盘文件。
- 查询与任务：被排除自动登记的内容仍可按实际路径查询、读取、引用和分析依赖，也可被用户显式指定处理；任务仍遵守原有授权与读写边界，不因缺少自动索引而直接认定不存在。
- 全量检查：模块源检查扫描全部已有有效定义，不应用自动登记目录过滤；显式 children 与知识/契约引用也不因排除登记而跳过。开发校验工具时使用 discover(..., apply_ignore=False) 获取完整定义范围。检查重复源时仍按前述 source 登记规则单独记账伴随文件。

默认 `.meta` 排除只是不单独索引这些伴随文件。Unity 资产移动、复制、删除时仍需正确处理对应元数据；其他类型如 DLL、配置和资源不自动类推排除。

## 模块源唯一性检查

```powershell
python design/scripts/check_module_sources.py --root "<工程根>"
python design/scripts/check_module_sources.py --root "<工程根>" --json
```

检查全部已有有效模块的 sources，直接扫描定义，不依赖派生注册表；不应用 .cbimignore 的模块自动登记过滤，仅对 source 条目按上述登记规则记账。支持 `--root` 指定项目根，默认根不随当前工作目录改变；复用注册表工具的扫描排除规则。只读，不移动源、不自动删除声明。空扫描、无效 JSON、字段缺失和无效路径均不能视为通过。

相同路径在同一模块、不同模块、祖先与后代模块重复出现分别报错。统一斜杠、点段、尾斜杠和大小写，解析可访问的符号链接；大小写按项目跨平台标识约定不敏感。拒绝绝对路径、越界、URI 和通配符；不要求尚未落盘的源必须存在。硬链接等未由路径解析揭示的物理别名，以及实际文件职责仍需人工核实。

父模块或祖先模块的 source 是子模块 source 的父目录或祖先目录，属于正常包含关系，记录在 JSON containments，不计错误或警告。跨分支模块（含兄弟模块的子模块）的物理目录包含属于项目工程结构存量问题，保留为 warning；同模块冗余包含、逻辑与物理层级方向相反也保留警告。精确相同路径或别名重复仍是错误，scope 不豁免。错误和警告保留双方模块 id、sources 下标、路径及 scope；不据警告自动迁移源码。

退出码：`0` 无错误或警告（允许正常父子包含）；`1` 有重复/输入错误；`2` 无错误但存在工程结构警告。有错误和待复核同时存在时返回 `1`，报告保留两类发现。不能将 `2` 当成全面通过；工程结构警告可以作为已知存量保留，记录实际维护边界，不为清零而改写模块树或搬迁源码。检查结果不证明实际实现正确，也不替代 Schema 和注册表检查。

由知识检查与维护流程将本项纳入必要验收；入口将此规范提供为工具上下文，Skill 不直接依赖脚本目录。修正后重跑检查并保留完整报告。具体命令输出可按宿主支持方式保存到本地任务记录。

## 文件覆盖与游离文件检查

模块知识治理须额外对照实际文件清单与全部有效模块的目录 source，暴露未被覆盖的文件。当前 `maintain_registries.py` 校验定义和索引，`check_module_sources.py` 检查已声明 source 的重复与包含关系；两者均不枚举项目全部文件，不能作为“无游离文件”的证据。

复用知识治理 Skill 自带的 [扫描脚本](../skills/knowledge-governance/scripts/scan_orphan_files.py)，不临时生成扫描实现：

```powershell
python -B design/skills/knowledge-governance/scripts/scan_orphan_files.py --root "<工程根>"
```

脚本将完整报告保存在项目的 `<用户主目录>/.cbim/<项目标识>/task-records/` 下，输出记录位置。退出码 `0` 无待处理项，`2` 有游离或待复核发现，`1` 检查不完整或无效；以 `summary.json` 和完整结果区分原因。脚本的回归测试位于同目录：

```powershell
python -B -m unittest discover -s design/skills/knowledge-governance/scripts -p "test_*.py"
```

执行时使用项目可用的文件清单工具或文件系统遍历，显式包含隐藏文件和未跟踪文件，记录扫描根、时间、跳过范围及错误。不能仅枚举 source 目录，也不能直接用默认受忽略规则过滤的文件清单宣称全量覆盖。全量检查以项目文件为范围；任何未扫描区域须在报告中说明，读取失败或遍历中断不视为零文件。

将文件路径与目录 source 规范化后匹配，再结合 scope 复核。无候选或被全部候选排除的文件归为游离文件；有候选但 scope 无法确定的文件归为待核实。自动注册忽略规则只提供说明，未覆盖且被忽略的文件仍单列路径和命中规则。知识链接或历史证据提及不替代维护归属。

保存逐文件结果与目录汇总，至少包含文件路径、覆盖状态、候选模块及 source、判断依据、忽略原因和扫描缺口。报告保存在本地任务证据中，不创建另一份权威模块注册表。存在游离项时报告归属缺口；未完成 scope 复核或扫描不完整时不能宣称覆盖检查通过。归属调整后重跑受影响检查，不直接改动实际文件。

## 索引维护流程

新增或调整 Agent、Module 时，先由执行任务的 Agent 按下述规则完成全局语义分析并在定义中写入 summary，再运行同步与校验。删除或仅移动目录时，核实已有摘要仍适用后运行：

```powershell
python design/scripts/maintain_registries.py --root "<工程根>" --write
python design/scripts/maintain_registries.py --root "<工程根>" --check
```

脚本扫描 `.cbim/team/` 下的 `agent.json` 和 `.cbim/workspace/` 下的 `module.json`，生成 Agent 与 Module 两个索引，同时校验插件声明注册表。Agent 和模块索引条目仅有 `id`（相对项目根的目录路径）与 `summary`。JSON 是结构化字段来源，Markdown 是被引用的正文；无需手动添加注册条目。`--write` 按当前定义重建索引，包括移除已不存在的条目；`--check` 只读检查，可供后续提交检查或 CI 调用。未配置自动监听，新增文件后须执行维护命令。

## Module 新格式与迁移期校验

默认 `--check` 与 `--write` 均严格执行新版 Module Schema。新格式以 `module.json` 保存压缩索引、同级 `module.md` 保存完整知识、`workflows/<工作流名>/workflow.md` 保存各自独立的操作流程。`id` 必须等于项目根相对模块目录；`children` 必须完整、无重复地列出直属子模块 id。`overview` 固定为 `module.md`；`workflows` 为 name、reference 对象数组，无流程为 []。引用须完整对应各直属流程目录的非空 workflow.md，名称和路径不重复；目录名为小写 snake_case，可包含脚本与资源。不再接受 boundaries、dna、workflow 字段，不保留 dna/、同级 workflow.md 或 workflows/ 下的扁平流程文件。

知识正文各节不得为空，必须且只能按序包含五个唯一二级标题：定位、子模块和 source 节点、结构关系图与抽象设计决策、雷区与排障、观察模式-待抽象；第三节包含一张非空 Mermaid classDiagram。不再兼容旧四节格式或额外章节。三级及更深标题仅允许第二节的 source 路径及规定的节点分组；注意事项和普通待验证问题直接并入雷区与排障。脚本检查标题、围栏、图数量、图类型与索引字段的显式重复，不验证 Mermaid 完整语法、设计正确性，也不能证明所有自然语言内容互不重复；这些仍需人工语义复核。依赖 contract 只能引用权威知识位置，description 与 purpose 仅保存压缩说明。

当前实例已经迁移，常规维护使用不带兼容参数的严格校验。仅在处理仍采用旧结构的历史实例时显式执行：

```powershell
python design/scripts/maintain_registries.py --root "<工程根>" --check --allow-legacy
```

兼容模式仅对不含任何新版布局字段的旧定义使用 `module.legacy.schema.json`，仍执行原 Schema、引用与清单完整性、摘要、作者及索引校验；混合新旧格式不回退。输出明确报告旧模块待迁移数量，**兼容通过不表示新版规范通过**。迁移期如需重建既有索引，`--write` 同样必须显式加 `--allow-legacy`。默认严格模式遇旧定义报错，且验证完成前不写任何索引。接口 `read_definition`、`build_plan`、`maintain` 默认 `allow_legacy=False`；调用方不得静默启用兼容。旧 Schema 仅作迁移工具，唯一目标规范始终是 `module.schema.json`。

## summary 生成规则

Agent 与 Module 必须包含 `authors` 数组，未知作者填 `[]`。Schema 校验数组类型与唯一性，脚本校验每个 id 存在于真人花名册且所有作者属于同一个已知组。人员改组后也重新校验这些约束；失败时不写入注册表。旧 `author` 字段不再接受，文档署名中的 `author` 不受影响。

路径基准为固定约定：`id` 是相对项目根目录（包含 `.cbim/` 的目录）的目录路径，统一用 `/` 分隔，不随当前命令目录或注册表位置变化。脚本默认根据自身位置确定项目根，也可通过 `--root` 显式指定；注册表不存储 `path_base`。Agent 注册表将 Team 树扁平索引为 `groups → agents`：组记录包含 `id` 和 `agents`，按 Team 树的完整目录索引任意深度节点，Agent 归直属 Team，空组保留。Module 注册表顶层仅包含 `modules`。

`.cbim/team/people.json` 统一保存真人花名册，每条记录仅包含 `id`、`name` 和 `team`。`team` 引用组目录 id，每人只属于一个组，未知为 `null`。脚本在写入注册表前校验字段、人员 id 唯一性及组引用，不自动推断或覆盖人员归属。

1. **生成责任属于 Agent**：读取目标完整定义及必要的专题知识、Skill 或 Workflow，理解真实职责与边界；结合三个注册表建立全局候选视角，再按需读取上级、相关子模块、依赖方和容易混淆的同类定义。全局分析指对目标在整体体系中的定位负责，不要求无差别加载全部正文。不得仅凭名称、目录、首段或长度生成摘要。
2. 摘要为 **100～250 字**，两端包含。统一按非空白 Unicode 字符计数：中文、英文字母、数字与标点均计入，空格与制表符不计入；这不是英文单词数或模型 token 数。可包含多个句子，但保存为单行文本。
3. **组织检索语义**：Agent 摘要覆盖能力范围、适用任务、专业方法与局限；Module 摘要覆盖负责的工作、核心对象、关键机制与边界。自然结合用户常用问题表述、可定位的故障现象、中文叫法、英文术语、缩写与必要别名，让用户不记得内部类名时仍有匹配线索。选择最有区分力的信息，不罗列无关术语、历史文件数量或实现细枝末节。
4. **兼顾召回与准确性**：对照相邻候选，明确本对象为何应命中、哪些相关任务应转到其他对象。所有职责、能力与问题类型必须由正文支持；遇到矛盾先核实，不把未知补写成承诺，不用笼统的“通用工具”代替真实范围。
5. **生成后进行语义检索复核**：为目标构造至少三种有代表性的正向查询（用户自然语言需求、专业术语或中英文别名、适用的问题现象）及两种易混淆的反向查询。结合注册表候选检查是否能召回目标、是否能与相邻对象区分；不足则补充缺失语义或收紧边界后重查。没有独立故障现象时使用操作或改动场景。该复核由 Agent 执行并在交付中说明范围，不向注册条目增加测试字段。
6. **写回与校验**：在 agent.json 或 module.json 中维护唯一的字符串字段 `summary`，脚本仅同步原文并校验。摘要缺失、重复、为空、超出长度或使用占位值时拒绝更新。即使 Positioning 或专业能力段落长度合格，脚本也不自动摘录，不代替 Agent 的语义分析。

高概率召回与准确匹配是摘要的设计目标，脚本检查通过只表示格式和索引一致性正确。不得据此宣称已测得召回率或保证所有查询命中；如需量化，应使用真实查询集、预期候选和实际检索结果评估召回及误匹配情况。

归档、待归属资料、专题知识、Skill、Workflow 与镜像目录不参与扫描。所有定义通过检查后才开始写入；每个文件使用临时文件替换，两个生成索引不构成跨文件事务，写入中断后可重新运行 `--write` 恢复一致性。

校验覆盖 JSON Schema、重复字段、作者同组约束、目录唯一、知识与执行引用、Agent Skill 清单完整性和 Module 知识及独立 Workflow 目录布局（兼容模式另检查旧 DNA／Workflow 清单）、全部条目覆盖及摘要一致性。旧 agent.md 或 module.md 定义会被拒绝，缺少 summary 时也不会从 Markdown 自动摘录。失败返回非零退出码。历史归档保持原样。

## 依赖与独立单元测试

脚本使用 jsonschema 校验 JSON Schema；缺少依赖时运行 `python -m pip install -r design/scripts/requirements.txt`。Schema 位于 `design/capability/agent.schema.json` 和 `design/business/module.schema.json`。

```powershell
python -m unittest discover -s design/scripts/tests -v
```

## Cindy 插件声明注册表

.cbim/connectors/registry.json 为人工核实宿主插件后维护的唯一声明真源。--write 只生成 Agent 与 Module 索引，不重写插件声明。--check 校验声明 Schema、id 与插件身份唯一性、Agent/Module 引用有效性；不验证插件当前运行状态或注入能力。

## Team 树与共享 Skill 校验

维护注册表时同时检查 Team 树全部节点（含无 Agent 的 Team）的 skills.json 和入口、每个 Agent 的完整继承链、同名或同目录名冲突及链接越界。目录是树的权威结构，注册表是扁平索引；references/、skills/ 等资料目录不作为 Team。共享清单只登记本层内容，不展开写回继承条目。

[解析工具](team_skills.py) 接受 --root 与 --agent，成功返回包含来源及入口哈希的完整清单，失败退出 1；只读，不加载网络或运行专业工具。Agent 缺失或 Team 结构无效时不降级到部分清单。

source 范围检查可加 `--report`，在本地任务记录输出逐项 Markdown 清单及原始 JSON；配合 `--json` 时输出中包含 report 路径。仅写报告，不修改模块或消除发现，原有退出码保持不变。知识治理固定入口默认启用该导出，避免临时编写报告脚本。
