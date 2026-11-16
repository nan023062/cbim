## 2026-11-16：design 只保留目标、取舍、未落地设计和原型

- 来源：用户要求继续精简 design，只保留四类设计内容；无关联 Issue。基线 `3a3b23af`。design 从 64 文件／53 份 Markdown 收敛为 19 文件／10 份 Markdown；39 个工程文件迁入 engineering，6 份重复说明合并删除，其余 19 个文件保留或收敛。新增 engineering 导航后该目录共 40 文件，不另建历史归档副本。
- 将 Agent／Module 概念分工合并到 product-model，四层、Agent 调用、领域引擎和更新方案只保留设计理由与重要边界；不再将已有记忆引擎及递归调度列为待实施。独立 UX 系统提案合并到全界面设计，保留真实评审原型、母版、预览与配套脚本。重复说明与改写前的完整设计正文已核对存在于已推送的 `8c06ff1edacbb296efb994e80eb941a811a1aa8c`；磁盘 CRLF 与 Git LF 仅作换行归一后比较，内容一致。
- engineering 承接 7 份操作指南、近期开发记录、28 份发布正文、一份公钥、一份被发布正文直接引用的验证说明及旧 Module Schema。发布正文、公钥与旧 Schema 原字节迁移，releases 与 verification 的相对关系保持；旧 Schema 仍仅供手工历史格式识别，不进入当前运行校验或资源包。
- 同步 README、AGENTS、CLAUDE、docs 01/04/05、三宿主开发／架构／发布入口、真实 assets 导航。assets 只调整资料位置说明与旧 Schema 引用；正文版本会随原机制变化，不改运行工具或 Schema 字段。历史开发命令与结果保留当时原文，仅迁移 Markdown 导航。
- Forge 默认发布正文改读 engineering/releases，CBIM_DESKTOP_NOTES 覆盖语义不变。CI 轻量白名单仅迁移开发记录和直接验证报告路径，工程指南、发布输入、兼容 Schema、嵌套报告及未知路径仍完整验证。修改 forge.config.ts 会改变既有冷基础指纹；不改签名身份或冻结基线，不绕过 COLD_BASE_CHANGED，后续制品按正常冷基础规则验收。
- 验证选择：只涉及 CI 分流、构建资料路径与资源收集，因此运行 `pnpm exec vitest run tests/ci-validation.test.mjs tests/runtime-packaging.test.ts --reporter=json --outputFile=build/refined-design-tests.json`，2 套件共 44 用例通过；新增工程目录不进资源包、Forge 输入改变指纹及白名单不能扩大的回归。夹具内容改变后运行 `pnpm check:test-modules`，543 文件通过（unit 176、contract 166、integration 201）。
- `node build/verify-forge-notes.mjs` 提取实际 generateAssets 函数体，替代品牌／引擎准备和签名配置依赖，在临时目录验证当前 0.1.21 默认正文、自定义覆盖、缺失版本失败和非发布跳过四种情况，全部通过；这不是打包或签名验收。`node build/verify-refined-design.mjs` 核对本地链接／锚点、三宿主一致性、docs 无反向资料依赖及 1,025 个受保护文件摘要，均无新增问题；源码、原型及发布输入保持原字节。核对脚本与 JSON 证据在忽略的 build 中，不新增持续维护工具。
- 未运行产品全量测试、类型检查、构建、浏览器原型重验、安装升级或发布；没有源码变更，无需改写 src 架构文档。原有 legal/cindy-LICENSE、legal/cindy-NOTICE 删除造成的 README 链接问题与 .idea/ 保持原状，不纳入提交。本轮仅本地提交，未推送。


## 2026-11-16：推送资料整理提交并补齐删除规范

- 来源：用户要求先推送架构文档调整与设计目录清理两个提交，再更新 docs 中的删除说明；无关联 Issue。先 fetch 核对远端可快进，按现有提交链推送 `1592814b`、`8c06ff1e` 及必要前置 `427543cf`，未改写历史。`git push origin HEAD:refs/heads/refactor/2026-11-16` 成功，随后 `git ls-remote` 核实远端为 `8c06ff1edacbb296efb994e80eb941a811a1aa8c`。
- 以文档 05 的“设计资料的保留与删除”为唯一详细规范，同步文档 01、04、06、07 的原则和流程入口。明确可退出维护的旧方案、重复说明、历史报告及配套快照，以及当前设计、运行资料、发布输入、兼容 Schema 和独立未提交工作的保留边界；清理前核实实际消费者和完整原文，历史链接指向可访问的固定提交，清理后同步导航与锚点。
- docs 只保存可复用规则，不写入本项目清理批次、删除数量或固定历史提交；具体实施事实继续在开发记录中维护。源码目录的单份架构文档约束不扩大到设计目录，删除报告不取消产品测试和发布验收。
- 纯规范验证：`node build/check-docs-deletion-policy.mjs` 核对 7 份文档、43 个本地链接和 6 个章节锚点，全部通过；没有 docs 反向依赖 design，原有代码格式正文及代码示例保持不变。`git -c core.safecrlf=false diff --check` 通过。未运行产品测试、类型检查或构建。
- 本次新增规范单独本地提交，未包含在先前的推送中。既有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 删除及 `.idea/` 保持原状，不纳入提交。

## 2026-11-16：清理设计目录中的旧方案与历史报告

- 来源：用户明确允许删除 design 中的大部分文档；基线 `1592814b`，无关联 Issue。本次只清理资料，不改产品、构建或测试逻辑。清理前 design 共 292 个文件、276 份 Markdown，核对真实加载、构建、发布流程及外部引用后确定保留范围。
- 删除 223 份 Markdown：159 份历史验证报告、59 份旧功能切片、两份已被新标准或设计取代的治理／替换记录，以及三个仅作旧导航或历史提案的文档；另删除两份历史架构 HTML 和三份配套截图。保留 64 个文件、其中 53 份 Markdown，涵盖当前产品与 UX 设计、四层与领域引擎方案、工程操作指南、发布资料及必要兼容资料。
- 保留全部 28 份发布说明和一份资源签名公钥原字节；0.1.10 发布说明直接引用的预下载验证说明继续保留，其历史外链同步归档。源码、assets、兼容 Schema、当前 UX 原型及配套脚本和资产均未改变。development-log 保留 2026-11-16 的 59 条原记录，356 条更早记录沿固定版本追溯。
- 历史原文选用已推送的 `c3178be11e24259d99ed59db60cc4781afb15782`，逐文件核对被删文档／快照与该提交的 Git 对象一致，旧开发记录正文也一致。重写 design 与 task 导航，将保留材料中的历史证据链接指向该固定提交；修正能力导航的实际 assets 路径，同步 README、AGENTS 和三套发布入口。当前实现继续从 src 的逐层模块模型阅读。
- 验证范围为纯文档清理：本地引用及章节锚点、历史 Git 对象、删除范围、多宿主一致性、受保护文件 SHA-256 与 diff 空白检查。`node build/verify-design-cleanup.mjs` 核对删除完整性及 1,048 个受保护文件未变，当前和历史引用无新增失效；`git -c core.safecrlf=false diff --check` 通过。临时清理与核对脚本留在忽略目录，不新增持续维护工具。
- 未运行产品测试、类型检查、构建或发布验收。README 的两处许可证链接仍受既有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 工作区删除影响；它们及 `.idea/` 保留原状，不纳入本次提交。未推送。

## 2026-11-16：架构文档改为面向人的逐层模块模型

- 来源：用户确认新的架构说明目标并授权更新规范、生成器及全部文档，进一步明确“子模块对于当前模块是虚拟类封装”，大型工程通过多层模型逐层解释。基线 `427543cf`，已查询开放 Issues 为空，无关联工单；本次不改变产品行为或重组业务目录。
- 更新 docs 01–07、AGENTS、CLAUDE、README、设计导航及三套开发／架构入口。每份 ARCHITECTURE 只解释本层设计意图、各类定位与关系，直接子模块标注 `virtual` 并链接自身文档；不强制文件、成员或参数清单，不把目录组合解释成实际继承。模板以“设计意图／主要组成”为人工入口，生成器只维护关系图与下钻导航。
- 人工重写 135 份源码目录说明，依据已有架构分析、当前声明及源码职责说明收敛为模块模型，保留 214 个本层类的定位与必要的函数／组件入口。134 个直接子模块边界只给出整体职责，不展开内部类型或成员。重要的状态与协作边界保留在简短定位中，参数级使用语义回到源码；旧契约正文可通过基线版本追溯，仍被引用的历史锚点保留为当前模块入口，不宣称它们仍保存旧明细。
- 生成器以人工组成表选择本层节点，以实际符号和文件依赖生成关系；同文件中的一个类被引用，不把其他类误连为依赖。别名与重导出继承保留真实来源，继承子模块内部类型在父层仅体现依赖虚拟封装；不从字段持有推断组合所有权。大图按最多六个节点分组，跨图关系明确列出；缺少类定位、错误源码入口、损坏标记或未解析依赖时仍拒绝整批写入，区域外正文保持不变。
- 验证选择：只改变文档及其生成逻辑，受影响单元为 `tests/source-architecture.test.ts`。`pnpm exec vitest run tests/source-architecture.test.ts` 16/16 通过，覆盖简洁模型、逐层虚拟边界、符号精确关系、真实继承、分图完整性、类型／动态／样式依赖、只读漂移、内部方法不扩图、CRLF 人工正文与围栏保护、整批拒绝及空目录。`pnpm check:test-modules` 543 文件、176 unit / 166 contract / 201 integration，归属及边界通过。
- 最终 review 发现未解析外部父类可能误匹配无声明的本层模块，修正空值匹配并新增回归，重新生成 Core 与通用组件两份图。定向执行 `pnpm exec vitest run tests/source-architecture.test.ts -t '未加载的外部父类|真实别名与重导出继承|每层把直接子模块'`，相关 3 项通过；最终套件共 17 项，未受此修正影响的用例沿用前次结果。
- `pnpm check:architecture`：135 个目录、837 个代码／样式文件、0 生成漂移；依赖检查为 1,680 文件、7,944 条边、0 循环及 0 逻辑边界违规。最后两份图修正后另执行 `node scripts/source-architecture.mjs --check` 核对生成同步。独立核对类定位、虚拟边界、图连线端点、下钻与 Markdown 引用、人工正文保留及多宿主一致性；161 张局部关系图均未超过六个节点，837 个源码／样式文件 SHA-256 与任务前一致。代表性人工 review 包括四层根、Application 装配、Core 工具类与任务视图；结构校验不等于自动证明全部自然语言设计解释。
- 独立链接检查覆盖 2,193 个当前或迁移引用，没有新增失效；README 的两处许可证链接受原工作区删除影响，开发记录中四处旧制品／旧方案链接在基线中已经失效，保留历史记录原状。
- 未运行产品测试、产品类型检查、构建、桌面或发布验收；未修改源码注释，因为业务代码与行为未变化。原有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 删除及 `.idea/` 保持原状，不纳入本次提交；未推送。

## 2026-11-16：核对架构生成入口并修正标准偏差

- 来源：用户要求检查代码中的生成逻辑与最新架构文档标准，发现偏差直接修正并重新校验；基线 `c3178be1`，当前开放 Issues 查询为空，无关联工单。审计仓库跟踪的生成脚本、源码模板、package 命令与 CI 调用：维护中的源码架构写入入口只有 `scripts/source-architecture.mjs`，直接生成与 `check:architecture` 共用逻辑。`moduleBodyTemplate` 生成产品业务知识正文，品牌、官网、资源包和引擎制品生成器分别输出运行资产／构建产物，不能强套源码目录说明标准；格式器只调整源码布局。忽略目录中的旧迁移脚本属于历史临时工具，未重新执行或纳入维护入口。
- 修正保护条件：此前两个生成标记都缺失时仍会追加生成区；现在必须有一对正确且独占行的标记，围栏中的示例不能作为写入依据。缺失、重复、逆序、损坏标记，以及空人工章节或重复章节均拒绝整批写入；注释、锚点和空小标题不能冒充语义正文。目录扫描与依赖检查使用相同的第三方／构建排除范围，并登记维护空目录，不能静默漏掉缺失的说明。
- 修正结构提取：补齐全局／命名空间声明、枚举、匿名默认类、调用／构造／索引签名；函数值属性及导出、访问器、运行时私有字段与具名方法分别表达，联合分支不冒充共同字段。绑定已扫描源码的类型符号，沿别名、默认导出、命名空间与重导出找到真实继承声明；补齐实际可调用的重导出入口，排除具名与星号的类型专用导出。未加载第三方类型或执行产品源码。样式依赖除静态导入外也核对动态 import 和 require，缺失样式阻止整批写入。
- 同步生成器文件头和关键说明、源码总览的维护契约，并刷新 135 份 ARCHITECTURE.md 的生成区；为文件图增加源码链接，标明函数值、访问器、匿名签名及全局声明的读法。除总览中显式补充的维护契约外，原人工说明保持；产品源码、源码注释、运行逻辑和格式未修改。
- 验证选择：变更只影响生成器，单元限定 `tests/source-architecture.test.ts`，使用临时目录验证实际写入和失败后的原文保持。`pnpm exec vitest run tests/source-architecture.test.ts` 为 17/17 通过；之后针对默认类真实名称调整执行 `-t '继承|重导出'`，2/2 通过；针对类型专用星号导出传播执行 `-t '公开|重导出'`，4/4 通过。新增覆盖围栏示例、CRLF 前后正文、空章节、全局声明、匿名签名、重导出、扫描范围和空目录；扩展缺标记和缺样式的整批保护用例。
- `pnpm check:architecture`：135 目录、837 代码／样式、0 生成差异；1,680 文件、7,944 条依赖、0 循环及越界。最后的公开导出过滤调整后，`node scripts/source-architecture.mjs --check` 仍为 0 差异；依赖输入未变，不重复运行相同依赖检查。`pnpm check:test-modules`：543 文件，176 unit / 166 contract / 201 integration，登记与边界通过。CI 已调用同一个 `check:architecture`，无需另设生成器或豁免。
- 独立核对 `node build/verify-generator-standards.mjs`：生成前后的 837 个源码／样式文件 SHA-256 一致，135 份文档人工区域逐字一致（快照在上述总览契约编辑后建立）；972 项直接文件、1,416 个实际声明和 5,941 个生成链接全部通过。`git -c core.safecrlf=false diff --check` 通过。临时核验脚本及 JSON 留在忽略目录，不成为另一套生成入口。
- 未运行产品行为回归、产品类型检查、构建、桌面、远端 CI 或发布验收；未重新审计全部人工契约，也未将静态核对视为 Mermaid 渲染验证。原有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 删除及 `.idea/` 保持原状，不纳入提交；未推送。

## 2026-11-16：统一全部 docs 的架构文档标准

- 来源：用户要求更新所有 docs 中关于架构文档的标准；基线 `1a8fd348`，无关联 Issue。本次修改 01–07 七份标准／概念文档，未改产品源码、源码架构说明、生成器或 Skill；此前源码资料核验的结果保留为历史证据，不重复宣称执行。
- 以 [05](../docs/05-工程文件组织与代码阅读设计.md#目录是系统封装) 为详细规则与模板的唯一维护入口：每个维护中的源码目录一份 ARCHITECTURE.md，集中意图、完整直接文件清单、类设计、契约、开闭边界及真实类图／导航。明确源码、样式、资源及必要许可证不受说明文档清理影响，目录组合不代表类继承；父层保留本层声明，区分真实方法、注入回调、联合类型分支及资源所有权。
- 补齐四个人工章节与生成标记模板、人工正文保护、批量预检失败条件、源码事实与未来方案分离、同片维护和偏差修正后的核验要求。01–04 引用统一标准并明确认知和交付职责；06 补充事实要求及本仓库映射；07 将资料核对纳入 S2、S6、S7 和完成定义。保留 05 的既有代码格式规范与 TypeScript 示例，未改变命名或排版约定。
- 验证选择：纯文档变更，只查规则、模板、事实边界、格式和引用。`node build/check-docs-architecture-standards.mjs` 检查 7 份文档、39 个本地链接（含 3 个章节锚点）、其余 6 份文档指向 05 的引用，全部通过；未发现 docs 反向引用 design。模板的四个人工章节与生成标记同现有生成器一致，代码格式正文及 TypeScript 示例保持不变。人工核对各文档分工、源码事实要求和验证边界无冲突；`git -c core.safecrlf=false diff --check` 通过。检查脚本为忽略目录内的临时核验，不作为持续校验入口。
- 未运行产品测试、类型检查、构建、外部链接网络校验或新一轮全仓源码语义审计。原有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 删除及 `.idea/` 保持原状，不纳入提交；未推送。

## 2026-11-16：核对源码架构说明并修正实际偏差

- 来源：用户要求核对全部 ARCHITECTURE.md 与源码，发现偏差直接改正并重新校验；基线 `da062e2d`，无关联 Issue。检查 135 个维护目录，实际更新 107 份架构说明，其中 35 份涉及人工正文；其余变更来自真实声明、依赖和导航的重新生成。
- 修复生成器遗漏：有子目录的目录仍完整展示本层类、接口、类型和成员，补回原先漏画的 165 个直接声明；父层只画直接子封装，不展开子目录内部结构。文件依赖与原检查器共用解析，包含类型、动态 import、require、已登记构建入口及 `.js` 到 TypeScript 的映射，补充 CSS；不明计算式加载、缺失源码或样式拒绝整批写入。跨文件继承显示真实导入来源及链接，不将项目内契约一律标成外部类。
- 人工说明对照源码修正旧方法名、回调归属、成员可见性、迁移后的模块位置、引擎目录与已接通的模型角色表单。修正主 Agent 在 Team 模式下的直接执行职责、退役执行者选项和办公室／显式运行核实的实际关系；移除不存在的未来接口示例与 planned 类图，替换为现有派发、成员执行、Runtime 和工具端口关系。联合类型仅在真实分支上展示 messageIds/taskIds/condition，保留旧章节锚点供已有导航使用。
- 运行设置页按唯一实际 AdmissionSettings 收拢职责，其余模型、网页、预算和主 Agent 配置链接到现有模块；同步三份架构维护入口，目录职责由本目录说明提供，不能再要求维护已移除的生成器目录表。产品源码注释和行为未改，837 个非 Markdown 文件逐字节摘要不变。
- 验证选择：本次只改变说明及架构生成工具，测试限定 `tests/source-architecture.test.ts`。`pnpm exec vitest run tests/source-architecture.test.ts` 为 12/12 通过，新增／扩展父层声明遗漏、动态与别名依赖、跨文件继承来源、缺源码／不明加载／缺样式时批次拒绝回归。`pnpm check:test-modules` 为 543 文件、176 unit / 166 contract / 201 integration，归属与边界通过。
- `pnpm check:architecture`：135 目录、837 代码／样式、0 生成漂移；1,680 文件、7,944 条依赖、0 循环、0 逻辑边界违规。独立核对 `node build/verify-architecture-audit.mjs` 检查直接文件与子目录清单、1,415 个声明、5,866 个成员、864 个公开函数、3,866 条源码内部依赖及 6,692 个源码／迁移导航链接，无新增遗漏、额外成员、错误类字段或失效链接。`node build/audit-manual-types.mjs` 以 TypeScript 类型解析核对 80 个手写图中的真实类型节点，未发现剩余成员或实现形式偏差；此项不是产品类型检查，也不证明任意运行时反射或全部自然语言契约。`git -c core.safecrlf=false diff --check` 通过，三套同名入口一致。
- 既有 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 删除仍导致 3 处许可证链接失效；未恢复、删除或改投这些法律文件，原 `.idea/` 也未纳入提交。未运行产品行为回归、产品类型检查、桌面、构建或发布验收；本次为源码事实与资料核对，不宣称通过全量运行验证。未推送。

## 2026-11-16：源码目录统一为一份 ARCHITECTURE.md

- 来源：用户要求每个维护中的源码目录只保留一份 ARCHITECTURE.md，统一封装意图、完整直接文件清单、类设计意图、接口契约、开闭边界及类图导航；基线 `a7a004d9`，无关联 Issue。范围为源码说明文档，源码、样式、配置和资源继续保留，不扩大为删除工程文件。
- 将 106 份 CONTRACT.md 和 READING、BOUNDARIES、SCHEDULING、FEEDBACK 四份说明合入所属目录，删除已合并的 110 份旧文件；135 个目录均只保留 ARCHITECTURE.md。契约按原章节保留稳定锚点，阅读路线与协作边界也在同一文件；每个直接类/模块依据真实声明与已有文件头补充阅读索引，不凭字段持有关系推断外部服务生命周期。引擎模型服务补充配置锁、公开快照、延迟凭据、错误与扩展责任说明。
- 生成器移除独立的目录定位表和契约附加逻辑：人工设计与契约在本文件维护，脚本只替换 `architecture:generated:start/end` 之间的清单、类图和导航，区域前后的正文逐字保留。目录定位从人工章节读取；缺少必需说明、生成标记损坏或出现多余 Markdown 文档时拒绝整批写入。资源目录同样纳入清单，不虚构代码类。
- 同步文档 05、AGENTS、CLAUDE、三套开发入口、README、分层说明与相关导航，清除活跃规范中的独立契约要求；历史验证只更新迁移链接，原日期、数字和结论不变，链接继续指向当前源码说明而非历史版本证据。三套同名入口逐字节一致，`.gitattributes` 保留唯一架构文档的 LF 约束。
- 验证选择：直接影响架构文档生成器，运行其隔离夹具测试，不运行产品行为套件。`pnpm exec vitest run tests/source-architecture.test.ts` 为 10/10 通过，覆盖完整清单/成员/目录边界、人工正文保留、只读漂移检查、多余文档拒绝、损坏标记的批次保护、唯一目录定位与资源目录。`pnpm check:architecture` 为 135 目录、0 生成漂移、1,680 文件、7,942 条依赖、0 循环/越界；`pnpm check:test-modules` 为 543 文件、归属与边界检查通过。
- 独立迁移核对 `node build/verify-architecture-consolidation.mjs`：837 个非 Markdown 文件摘要不变，1,532 张生成结构图逐字一致；110 份原说明的 3,187 段内容迁入，另有 3 段旧文档维护指引按新规则更新；6,319 个源码说明及迁移导航链接没有新增失效。所有目录具备要求的章节及唯一生成区域，三套入口一致；`git -c core.safecrlf=false diff --check` 通过。
- 现有缺口：`legal/cindy-LICENSE`、`legal/cindy-NOTICE` 在本次开始前已删除，造成 Pi 与会话说明中的 3 条原有许可证链接不可达；保留这两项工作区删除及 `.idea/`，不纳入本次提交。未做全仓业务语义重新审计，未运行产品类型检查、全量回归、桌面、构建或发布，未推送。

## 2026-11-16：按独立语句留白，并修正 if 执行体布局

- 来源：用户指出 if 与执行体之间、同一构造调用的参数之间不应插空行；基线 `a14f6378`，无关联 Issue。将先前按物理行插空的实现改为按独立语句和成员分隔：参数、链式表达式、多变量声明、数组和普通对象表达式内部连续排列，函数与成员之间仍空一行。
- if/else 的单行普通执行体省略可安全删除的大括号并紧接条件；多语句或单条语句跨行时采用 Allman 块。只处理语法树中原本属于分支的执行体，保留作用域、自动分号插入与 else 归属所需的括号；else if 和完整单行箭头保留原规则。多参数规则补充 new 构造调用，不设置自动换行数量阈值。
- 全量扫描 782 个脚本，重排 588 个文件（Bridge 20、Core 13、Logic 369、View 186）。写入前逐文件检查等价与幂等性；独立核对写入后的 588 个文件，其中 540 个仅改变空白，48 个调整了作用域中性的单语句 if 包裹块。仅忽略这些包裹块后，语法树、其余非空白 token、字面量和注释原文均一致，没有更名、调整调用顺序或改变依赖。
- 同步文档 05 的第 6、9、10 条与示例、AGENTS、三套开发入口、CI 说明、src/CONTRACT 和生成的 src/ARCHITECTURE。全部受影响脚本保留现有文件头及成员注释，135 个目录的节点与依赖没有结构变化；三套入口逐字节一致。
- 验证选择：格式器是直接受影响单元，新增截图、参数续行、单/多语句 if、作用域、else 归属、ASI 和真实执行对比；另验证截图涉及的模型选择规则。`pnpm test:module --module tooling/source-format` 为 31/31 通过；重排后 `pnpm exec vitest run tests/unit/logic/engines/model-choices.test.ts` 为 3/3 通过。真实执行用例比较真假分支、循环跳转、异常及后续独立语句的结果。
- 静态验证：`pnpm typecheck` 通过；`pnpm check:source-format` 为 782 文件、0 漂移，报告 170 段必要保留范围（注释 116、控制流 14、字面量 2、JSX 38）；`pnpm check:test-modules` 为 543 文件、全部登记通过；`pnpm check:architecture` 为 135 目录、0 文档漂移、1,680 文件、7,942 条依赖、0 循环/越界。临时校验 `node build/check-if-spacing-document.cjs` 核对 10 条规范、6 段示例语法及格式、3 个真实本地引用和入口一致性；`node build/verify-if-spacing.mjs` 核对重排前后语义边界、文件头与目录说明；`git -c core.safecrlf=false diff --check` 通过。
- 未运行全仓行为回归、完整产品 CI、桌面、打包或安装升级验收；未推送。现有 `.idea/` 及 `legal/cindy-LICENSE`、`legal/cindy-NOTICE` 的删除保持原状，不纳入本次提交。

## 2026-11-16：修复函数与成员之间缺少空行

- 来源：用户截图指出 EnginePackages 的构造函数、Init、Save、Trusted 紧邻无空行；基线 `43ac79d8`，无关联 Issue。原因是此前把“大括号承担间距”错误扩展到成员边界，覆盖了原有的成员间空一行要求；同时纠正规范及自动校验，不将其视为用户新增风格。
- 格式器按语法节点区分成员/独立声明与块内控制流：相邻函数、方法、构造函数、属性、字段、接口成员及对象方法之间保留一个空行，有注释时放在下一成员注释之前。首成员、块内首尾、连续大括号和 else/catch/finally 不额外插空；单行箭头、内联类型及调用参数规则保持。
- 全量扫描 782 个脚本，通过 `formatSources(process.cwd(), true)` 修复 546 个文件；写入前后语法树、非空白 token、字面量和注释原文一致，重复排版稳定。截图文件已恢复各成员之间的空行，没有调整成员命名、顺序或行为。
- 同步文档 05、AGENTS、三套开发入口、src/CONTRACT 与生成的 src/ARCHITECTURE；原有注释内容保留。三套入口逐字节一致；135 个目录的类图结构未变，仅总入口契约说明更新。
- 验证：`pnpm test:module --module tooling/source-format` 为 24/24 通过，新增截图场景、注释/属性、顶层/嵌套函数及对象方法的回归；`pnpm check:source-format` 为 782 文件、0 漂移；`node build/check-format-document.cjs` 验证 9 条规范、5 段示例和 3 个本地引用；`pnpm check:architecture` 为 135 目录、0 文档漂移、1,680 代码文件、7,942 条依赖、0 循环/越界；`git -c core.safecrlf=false diff --check` 通过。
- 生产代码仅调整空白，未重复运行产品类型检查、全仓行为回归、桌面或构建验收；未推送。原有 `.idea/` 保留，不纳入提交。

## 2026-11-16：补充多参数调用的换行对齐规则

- 来源：用户要求函数调用参数过多时换行对齐，每行一个参数，首参数与左括号之间不空行；基线 `d0a67bfa`，无关联 Issue。文档 05 新增第 9 条及示例，方法声明、必须单行的导出声明与完整箭头函数继续遵守既有约定。
- 不擅自设定参数数量阈值：是否分行由维护者按阅读需要选择，格式器规整并校验已分行的调用；每个同级参数另起一行并对齐，首末参数与圆括号之间不加空行，参数行之间保留既有留白。补齐嵌套调用、对象参数和参数注释的处理。
- `pnpm format:source` 扫描 782 个脚本，调整 12 个文件的调用布局；所有候选通过语法树、词法内容、注释及幂等检查，写入后再次核对这 12 个文件的 AST、token、字面量及注释原文一致。同步 AGENTS、src/CONTRACT 及生成的 src/ARCHITECTURE；方法签名、参数顺序和业务行为未改动。
- 验证：`pnpm test:module --module tooling/source-format` 为 20/20 通过；`pnpm check:source-format` 为 782 文件、0 漂移；`node build/check-format-document.cjs` 验证 9 项规则、5 段 TypeScript 示例及 3 个本地引用；`pnpm check:architecture` 为 135 目录、0 文档漂移、1,680 代码文件、7,942 条依赖、0 循环/越界；`git -c core.safecrlf=false diff --check` 通过。
- 生产代码仅改变空白，测试集中在格式器，未重复运行产品类型检查、全仓行为回归、桌面或构建验收；未推送。原有未跟踪的 `.idea/` 保留，不纳入提交。

## 2026-11-16：全量源码重排并接入持续格式校验

- 来源：用户要求按新格式规范全量重排源码并接入校验；基线 `856e00f4`，沿当前重构分支实施。读取开放 Issues 清单为空，没有关联工单，不创建或变更外部 Issue。
- 扫描 782 个源码脚本，重排 725 个工作区文件（Bridge 42、Core 17、Logic 451、View 215），其中 12 个仅统一行尾，Git 实际源码排版差异为 713 文件；语法树、非空白 token、注释与字面量前后一致，重复排版无变化。156 段必要的注释、字面量或 JSX 换行按语法保护并报告，不按文件放宽校验。
- 新增 `pnpm format:source`、`pnpm check:source-format` 和 JSON 诊断入口，登记 `tooling/source-format` 单元并接入 CI 公共静态检查；同步 AGENTS、CI 说明及源码 CONTRACT/ARCHITECTURE。135 个目录架构核对无结构漂移，所有受影响脚本已有文件头和目录架构文档。
- 验证：格式器单元 16/16、依赖检查器 178/178；格式、类型、方法命名、架构/依赖、测试归属及 diff 空白检查通过。依赖检查首次被 `locking.ts` 精确登记中的旧空格格式拦截，同步该表达式后通过，未扩大动态加载白名单。完整命令、修正及验证边界见 [验证记录](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/2026-11-16-source-format.md)。
- 未运行全仓行为回归、桌面冒烟、打包或安装升级验收；未运行远端 CI、推送或发布。保留原有未跟踪的 `.idea/`，不纳入提交。

## 2026-11-16：补充代码逐行留白与大括号间距规范

- 来源：用户要求每行代码之间空一行，大括号本身算作间距，并明确格式与风格是源码阅读体验的一部分；基线 `d848b1d5`。直接规范维护请求，无关联 Issue；本次更新规范与示例，未批量重排产品源码。
- 文档 05 第 6 条改为代码行间距规则：普通代码行间恰好空一行，独占行的大括号前后不额外留白，注释紧贴成员；既有单行 import/export、方法签名、箭头函数保持完整，字面量与 JSX 内容不变。同步静态工具类与实例类示例，明确格式化工具不得压缩规定留白。
- AGENTS 同步间距与既有单行规则；架构维护、架构治理、开发流程的三套入口同步更新旧的成员空行约定，避免与大括号间距冲突。未修改源码、模块边界或架构类图。
- 验证：`node build/check-format-document.cjs` 通过，覆盖 8 项规则、4 段 TypeScript 示例语法、3 个本地引用及围栏配对；`node -e` 使用 `Buffer.equals` 核对上述三个流程各自的三份入口，全部逐字节一致；`git -c core.safecrlf=false diff --check` 通过。人工核对示例留白与规则一致。
- 纯文档及流程说明变更，未运行产品测试、项目类型检查或构建；保留未跟踪的 `.idea/`，不纳入提交。

## 2026-11-16：全仓方法 PascalCase 自动校验与迁移

- 来源：用户要求方法大驼峰跑自动校验，不符合直接修改；基线 `bc72dea4`，继续原重构分支，无关联开放 Issue。
- 新增 `pnpm check:method-names` 并接入 PR 静态检查，覆盖类、接口、类型字面量和对象方法；精确登记固定协议例外，例外失效或重复命中会失败。782 个源码脚本、1,996 处声明，1,947 处完成大驼峰，49 处浏览器/框架及已发布引擎协议名称保留，最终 0 违规。
- 按 TS 符号同步真实消费者，并修正 Pick/索引类型、字符串调用、可选回调、函数属性别名、any/never 私有访问及测试替身。保留固定 EngineAdapter protocol=1 的工厂、生命周期、上下文、工具、运行包和预算方法；未更换已发布版本、持久化字段或 IPC 操作名。
- 实际修改 347 个源码文件，475 个既有测试文件和 66 个脚本同步引用；新增检查器测试。源码接口注释、47 份阅读/契约文档、90 份 ARCHITECTURE 同步；文档 05 和 AGENTS 增补函数值实现方法契约及自动校验边界。命名/别名归一化后 347 文件 AST 结构一致，不以此代替行为验证。
- 验证：命名、类型、架构/依赖、测试归属和文档检查通过；依赖为 1,677 文件/7,940 边、零循环/违规。选取 125 套件（93 单元、29 契约、3 集成），失败后只复验对应套件或用例，最终分轮去重 979/979 通过。实际命令、失败修正和验证范围见 [验证记录](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/2026-11-16-method-naming.md)。
- 未运行全量本地回归、完整产品 CI、桌面、打包及安装升级；未跟踪的 `.idea/` 保持原状。

## 2026-11-16：清除源码折叠分区标记并修正方法命名规范

- 来源：用户要求所有方法改用大驼峰，并进一步要求现有折叠分区标记全部删除、不再作为格式要求；基线 `a3a90d79`，无关联 Issue。方法命名本片更新规范与示例，源码修改仅清除分区标记及相邻多余空行。
- 扫描 782 个源码脚本，从 10 个文件删除 142 处标记：core/utility 的六个文件、core/platform/node/serialization.ts、Logic/Bridge 两个 Application 入口及 evidence/runtime/agent-artifact-verification.ts。保留访问级别、成员顺序、方法签名、字段初值、成员说明与业务执行内容。
- 写入前验证 10 个文件的语法树、字面量及声明类别一致，全部非分区注释文本和顺序一致；检索 src、docs、AGENTS、三个宿主入口、scripts 和 tests 无残留分区标记。一次性清理脚本、快照与报告留在忽略的 build，首次试算因未遍历结束符前注释而停止，修正注释收集后才统一写入源码。
- 文档 05 与 AGENTS 将方法命名改为 PascalCase，覆盖实例、静态及接口方法；同步 Read、Redact、Increment 等示例，字段和属性沿既有规则。root CONTRACT 改为按成员顺序、访问修饰符、空行及中文说明阅读，格式与命名引用文档 05；重新生成根 ARCHITECTURE。其余目录类图检查无差异，未虚构节点或修改真实依赖。
- 验证：`node build/remove-source-region-comments.cjs` 完成清理及 AST／其余注释等价检查；`node build/check-format-document.cjs` 的 8 项规则、4 个 TypeScript 示例、3 个引用及围栏检查通过；`node scripts/source-architecture.mjs --check` 为 135 目录／837 代码样式文件、0 漂移；`git -c core.safecrlf=false diff --check` 通过。仅注释、空行及文档变化，未运行产品测试、项目类型检查、依赖检查、构建或桌面验收；未跟踪的 `.idea/` 保持原状。

## 2026-11-16：补充箭头函数整体单行规则

- 来源：用户明确箭头函数也保持一行，不主动换行；基线 `d0aee7bc`，无关联 Issue。本次继续维护格式规范，未批量修改源码。
- 文档 05 新增第 8 项：箭头函数的参数、返回类型、箭头及整个正文保持单行，带代码块、多条内部语句、async 和回调形式同样适用；明确其为 Allman 与逐行语句规则的例外。同步修正原大括号、导出初始化回调、方法签名及格式化边界中的冲突表述。
- 增加表达式、代码块和带类型箭头函数的单行示例，AGENTS 同步例外摘要；保留字面量、JSX 文本、注释及 this 语义。既有未跟踪的 `.idea/` 保持原状，未纳入本次提交。
- 验证：`node build/check-format-document.cjs` 通过，覆盖 8 项规则、4 个 TypeScript 示例语法、3 个本地引用及围栏配对；`git -c core.safecrlf=false diff --check` 通过，并检索确认原“箭头函数正文另起一行”的要求已移除。仅文档变更，未运行产品测试、项目类型检查或构建。

## 2026-11-16：补充字段、方法与属性命名规范

- 来源：用户补充私有／受保护变量以下划线和小写开头，公开变量小写开头，方法及属性采用驼峰命名；基线 `f7dfe3a0`，无关联 Issue。本次延续格式规范维护，仅更新文档与示例。
- 文档 05 新增第 7 项“成员命名”：私有／受保护字段为 `_camelCase`，公开字段及全部方法、属性为 `camelCase`；明确静态、只读、构造函数参数属性与普通局部变量的适用方式。保留运行时私有语义、框架约定及固定协议键，命名迁移同步真实引用。
- 将静态工具示例的 replacement 和实例示例的 count 改为带下划线的字段名，并同步示例引用；AGENTS 增加对应命名摘要。未批量重命名产品源码，也未更改既有协议。
- 验证：`node build/check-format-document.cjs` 通过，覆盖 7 项规则、3 个 TypeScript 示例语法、3 个正式本地链接及围栏配对；`git -c core.safecrlf=false diff --check` 通过。仅文档修改，未运行产品测试、项目类型检查或构建。

## 2026-11-16：移除格式规范中的折叠分区注释

- 来源：用户直接要求不再使用折叠分区注释，并从格式规范中移除；基线 `54244abb`，无关联 Issue。本次范围为规范、示例与对应入口说明。
- 文档 05 移除 region/endregion 标记要求及静态工具类、实例类示例中的全部折叠标记，改用成员顺序、访问修饰符和空行表达结构。保留私有／受保护／公开排序、字段／属性／构造／方法排序、成员中文说明及既有 Allman、单行声明要求。
- 同步 AGENTS 和 architecture-maintenance、architecture-evolution、cbim-development 的三个宿主入口，避免旧入口继续要求添加折叠注释。历史开发记录保留当时事实，未批量修改存量源码。
- 验证：`node build/check-format-document.cjs` 通过，含 6 项格式规则、3 个 TypeScript 示例语法、3 个本地引用及围栏配对；Node 检查 11 份规范／入口不含折叠标记，3 组 Skill 的三份内容分别一致；`git -c core.safecrlf=false diff --check` 通过。仅文档变更，未运行产品测试、项目类型检查或构建。

## 2026-11-16：代码格式规范集中整理进文档 05

- 来源：用户直接要求将已确认的源码格式整理进 docs/05，无关联 Issue；基线 `b9f9372d`。本次仅维护文档，未继续修改源码或运行业务重构。
- 将原先分散在“文件与声明”的格式要求集中为“代码格式规范”：Allman 大括号、逐行语句、import 置顶、import/export 单行、方法签名单行、成员间空行。保留原封装、分区和注释要求，补充导出示例与 TypeScript 语法边界，说明格式化工具的行宽不得覆盖单行声明要求。
- 明确内联类型、回调代码块、动态 import、字面量和 JSX 文本的处理；格式调整需保留语义，不将 C# 阅读布局误当作语言或运行机制迁移。通用规范不引用本次项目验证记录。
- 验证：`node build/check-format-document.cjs` 核对 6 项规则、3 个 TypeScript 示例的语法、3 个正式本地链接及代码围栏配对；`git -c core.safecrlf=false diff --check` 通过。一次性校验脚本保留于忽略的 build；未运行产品测试、项目类型检查、构建或架构生成。

## 2026-11-16：源码阅读排版修正——单行声明、导入区与成员间距

- 来源：用户继续明确静态 import 置顶、与正文空一行，方法签名整行书写，方法／字段／属性之间空一行，import、重导出及截图所示导出表达式不主动折行。基线 `9b72f9b6`，继续原重构分支；本片将排版约定应用于全仓 782 个源码脚本，实际调整 778 个。没有改动业务 API、初始化表达式或执行流程。
- 六个文件原本将静态导入穿插在正文间：workspace IPC 导出、Pi RPC 导出、知识对象 CRUD 重导出、资源仓库内部接口以及 App/ExtensionArea 的延迟页面声明。保持静态导入之间、正文声明之间的各自顺序，并核对编译后首次运行时模块请求顺序；动态 import 仍处于原回调和延迟加载位置。
- 展开类、接口、函数及控制流的 Allman 大括号和连续语句；单行保留方法签名、导入、重导出和没有独立代码块的导出表达式。签名及单行声明中的内联类型不另拆行；字符串、模板、正则及 JSX 文本不作排版内容改写。成员说明贴近所属成员，dispatch.task 的兼容说明移到导出表前并明确指名该键。
- 同步 AGENTS、docs/05 与根 CONTRACT 的约定；生成根、View 与 shell 的 ARCHITECTURE，更新实际扫描顺序和阅读说明。其余目录类图经检查没有漂移，代码节点、职责和依赖关系未变，不为纯空白调整制造架构关系。既有成员注释保留；本片不等于全仓成员语义、工具类迁移或业务边界已经人工整理完成。
- 验证使用 TypeScript AST 对比全部 782 文件：相对排版前快照，节点、变量声明类别、字面量及 JSX 文本一致；相对本片原始基线，静态导入和正文的各自有序 AST 一致，编译后首次模块请求顺序一致。最终检查 3502 个方法签名、4380 条静态导入、239 条重导出、5252 处成员间距、9709 个代码／声明块及 28845 处相邻语句，未发现规则违规或应合并的导出表达式。
- 类型检查通过。架构检查最初因 locking.ts 的原生加载表达式空白变化而未匹配已审核清单，恢复该表达式原有紧凑写法后通过；没有修改检测器或扩大动态加载许可。最终为 135 目录／837 代码样式文件、0 架构漂移，1674 文件／7938 依赖、0 环／0 违规，8 处既有已审核外部加载。

```powershell
node build/check-declaration-reading.cjs
node build/verify-final-source-layout.cjs
pnpm typecheck
pnpm check:architecture
git -c core.safecrlf=false diff --check
```

- 上述检查通过；过程辅助脚本、快照和报告保留在忽略的 build，不作为产品代码提交。原类型检查进程回执在宿主恢复后不可取得，最终版本重新执行并取得成功回执。没有更改行为、测试归属或测试夹具，未重复已通过的产品用例，未运行全量回归、构建、桌面或发布验收。

## 2026-11-16：源码阅读排版修正——Allman 大括号与逐行语句

- 来源：用户复核 Core 后明确补充两条要求：类、接口、方法等大括号独占一行，与 C# 一致；每条表达式／语句逐行书写，不在同一行连续压写。基线 `501feb5c`，沿原重构分支实施；Agent 模块仅完成只读核对，尚未改动。
- 统一 Core 全部 24 个源码文件及此前已整理的两个 Application 入口：展开空方法、构造、访问器、控制流和连续语句，else/catch/finally 独立起行，多变量声明逐项换行。导入、解构与对象字面量按 TypeScript 语法保留，避免 return/throw 自动分号变化。没有重排执行、变更访问权限、迁移公共 API 或修改算法。
- 在 docs/05 和 AGENTS 明确两条排版要求，并修正两个 TypeScript 规范示例；Core CONTRACT 增加阅读约定，重新生成根类图附录。其它目录类图经生成核对无差异，声明、职责及依赖关系均未变化，不为排版虚构新节点或连线。
- 写入前逐文件比较规范化语法树，保留变量声明类别、字面量内容及全部执行结构；26 文件全部通过。基于 AST 核对 265 个声明／代码块大括号和 988 条同级语句，未发现同行压写；两个规范示例语法有效。一次性辅助脚本及原始快照位于忽略的 build 目录，不作为产品或正式工程工具提交。
- 实际验证：`node build/check-source-reading-layout.cjs`、`node scripts/source-architecture.mjs --check`、`git -c core.safecrlf=false diff --check` 通过；架构生成检查为 135 目录 / 837 代码样式文件、0 差异。只改排版和说明，未重复产品测试、类型检查、依赖检查、构建或桌面验收。
- 本片修正阅读排版，不把 Core 其余模块的成员注释、工具类迁移或全仓业务模块整理报告为已完成。后续整理统一沿新排版要求执行。

## 2026-11-16：源码阅读整理——Application 生命周期入口

- 延续用户按文档 05 整理源码的直接要求，基于 `6becfe58`。本片完整阅读 Logic Application、Bridge 适配器及初始化协作者，整理两个源码文件，保护原服务注册、并发打开、退出和失败恢复语义。
- Logic Application 按私有／公开及字段／属性／构造／方法分区，显式列出 paths/platform 字段，补齐逐成员中文说明，展开构造、open、stop、shutdown 等压缩控制流。同文件 ApplicationPlatform 仅命名原有宿主能力形状；Bridge Application 保持三个重载连续，仍只委托 IPC 路由，未另建生命周期或服务。
- 初始化核对：调整位置的初值为独立 Map、标记与监管／准入对象，没有跨字段读取；两个带 UUID 的对象仍保持原先相对创建顺序。构造体中原服务装配顺序不变。编译后逐成员 AST 比较确认所有方法体（含构造参数赋值）与字段初值保持一致；这项核对不代替真实行为验证。
- 同步两文件的文件头、字段、方法、内部契约及分区，更新 Logic application 和 Bridge server 的 CONTRACT 及 ARCHITECTURE；新增类意图、状态所有权和阅读顺序说明。两份契约的本地链接、分区配对及类／接口逐成员说明检查通过。
- 验证选择：Application runtime 覆盖多工作区、实例重开、活动投影与历史；workspace lifecycle 覆盖并发打开、失败重试、事务排空与退出；core domains integration 保留关闭后快照读取；desktop update lifecycle 覆盖延后恢复和关闭调用方，不属于实际安装验收。

```powershell
pnpm exec vitest run tests/application-runtime.test.ts tests/workspace-lifecycle.test.ts tests/core-domains-integration.test.ts tests/desktop-update-lifecycle.test.ts --reporter=default --reporter=json --outputFile=build/source-reading-application-tests.json
pnpm typecheck
pnpm check:architecture
```

- 4 文件 / 13 用例通过，报告保留在 `build/source-reading-application-tests.json`。类型检查通过；架构检查无漂移，1674 文件 / 7938 依赖、无环无违规。测试归属和导入未改变，未重复测试模块登记检查。开发进程中断后已核对文件、提交和测试报告；原类型检查回执丢失且进程已结束，仅补跑该项并取得成功结果，没有重复前两次提交或已通过的测试。
- 本片仍保留原打开／关闭流程，未提炼新的生命周期抽象、移动业务目录或修改权限／持久化协议。未运行全量回归、桌面真机、构建、安装升级或发布；全仓其它业务源码仍需按内聚模块逐成员整理，不能从导航覆盖率推断已经完成。

## 2026-11-16：源码阅读整理——全局导航与完整目录清单

- 延续用户按文档 05 熟悉并整理源码的直接要求，基于首片 `119e873a`。核对四层实际依赖、桌面/IPC 入口、Conversation.send、WorkspaceExecutionManager.launch、应用装配、Agent 调用及日志路径；现有边界仍适用，本片不移动业务目录或改运行行为。
- 新增 `src/READING.md`，按四层地图→一次发送→状态与资源所有者→业务修改入口组织阅读；从根 CONTRACT 进入。区分新 Agent 协议和旧日志恢复、原始日志和历史索引、执行结束和业务验收；没有把目标方案当成已经实现的事实。
- 生成器将目录清单扩为全部直接文件，包含 CONTRACT、辅助说明、样式和资源；保留代码依赖图的原范围。类图明确静态成员、构造函数和运行时私有字段；说明与资源不伪装成代码节点。135 份 ARCHITECTURE 同步生成，逐类语义仍以实际源码及人工维护契约为准，不宣称全仓成员整理完成。
- 生成器相关验证：`pnpm exec vitest run tests/source-architecture.test.ts`，1 文件 / 6 用例通过；新增清单完整性与首次生成幂等、静态/实例/私有成员用例。既有套件归属和导入未变，不运行无关产品测试。
- `pnpm check:architecture` 通过：135 目录 / 837 代码样式文件，无生成漂移；1674 文件 / 7938 依赖，无环、无违规。Node 检查新阅读导航 57 个本地链接有效，135 个维护目录的 1082 个直接文件全部有清单链接；`git -c core.safecrlf=false diff --check` 通过。
- 本片只改生成器、其测试和源码说明，未重复首片已通过的 104 项产品测试，未运行类型检查、全量回归、桌面、构建或发布。当前资料帮助定位与 review，不替代各业务模块后续的逐成员组织和语义验证。

## 2026-11-16：源码阅读整理——共享 Core 工具库

- 来源：用户明确要求按文档 05 整理代码与文件，以便先熟悉源码。基线 `a87be67c`，工作分支 `refactor/2026-11-16`。已分页核实开放 Issues 为 #65、#94、#95；没有对应源码阅读整理工单，本步按直接要求实施，不创建或改写无关 Issue。PR #96 的同一基线已合并且完整 CI 43810478834 通过，该旧证据不替代本次修改验证。
- C3/L2：先完整阅读本工具目录及直接消费者，以便携机制为首片。JSON、字符串、字节和图算法分别迁为 JsonUtils、StringUtils、ByteUtils、GraphUtils；SerialQueue、PendingRequests、InFlightOperations、LineFramer 保留实例状态。成员按私有/公开和字段/属性/构造/方法分区，补充真实中文语义，展开原压缩控制流。
- 迁移全部独立函数消费者及相关测试，utility 不保留旧函数导出。仍在使用的 Node `serialization.json` 直接引用 JsonUtils.formatJson，保留函数身份、序列化字节和原消费者契约；没有包装第二套实现。没有移动业务目录或改变事务、权限、恢复、比较器、取消及真实排空策略。
- 同步文件头和调用边界说明、utility 的逐类阅读表与契约，以及 20 个受影响目录的 CONTRACT/ARCHITECTURE。完整改动可通过本条对应提交与其父提交比较；先读 `src/core/utility/CONTRACT.md`，再读 index、json/strings/bytes/graphs 和 async，最后看消费者差异。
- 验证选择：10 个 utility 单元覆盖算法与实例状态；6 个原消费者契约覆盖历史字节、错误、流取消、脱敏和 RPC；前端比较、任务图、资源存储/HTTP 与记忆引擎/协议补足直接消费者。22 文件 / 104 用例通过，报告 `build/source-reading-core-tests.json`。

```powershell
pnpm exec vitest run tests/unit/foundations/utility/bounded-bytes.test.ts tests/unit/foundations/utility/graphs.test.ts tests/unit/foundations/utility/in-flight.test.ts tests/unit/foundations/utility/json-order.test.ts tests/unit/foundations/utility/json-text.test.ts tests/unit/foundations/utility/line-framer.test.ts tests/unit/foundations/utility/pending-requests.test.ts tests/unit/foundations/utility/redaction.test.ts tests/unit/foundations/utility/serial-queue.test.ts tests/unit/foundations/utility/strict-json.test.ts tests/utility-body-consumers.test.ts tests/utility-json-contract.test.ts tests/utility-json-order-contract.test.ts tests/utility-redaction-contract.test.ts tests/utility-rpc-framing-contract.test.ts tests/utility-serialization-contract.test.ts tests/unit/frontend/foundations/utility/json.test.ts tests/dispatch-graph.test.ts tests/resource-store.test.ts tests/resource-repository.test.ts tests/unit/logic/execution/memory-protocol.test.ts tests/unit/logic/execution/memory-engine.test.ts --reporter=default --reporter=json --outputFile=build/source-reading-core-tests.json
```

- `pnpm typecheck` 通过；`pnpm check:architecture` 通过：135 目录 / 837 代码样式文件、1674 维护文件 / 7938 依赖、0 环 / 0 违规；`pnpm check:test-modules` 通过：541 文件（174 unit / 166 contract / 201 integration），归属未变。另核对 6 个 utility 源码的分区配对；后续仅修正文案与元组换行，并重新生成对应文档，无行为变化。
- 编辑工具首次拒绝同路径 delete/add 的补丁，未改文件；一次性迁移脚本首次未加载 JS 文件而停止，修正读取范围后完成。两者均为编辑工具问题，不是测试失败。辅助脚本与测试报告仅留在忽略的 build 目录，不进入产品或正式工程工具。
- 四问：保护 JSON 字节/错误、实例状态与取消契约；组织变化限制在基础类和显式调用入口；验证由本片公共 API 和真实消费者确定；同类算法从对应静态类扩展，有状态能力从实例类扩展。第五问无新增规则候选，执行已存在的文档 05。
- 本片完成的是共享工具库及调用入口的整理，不代表全仓 782 个源码脚本已逐成员整理。未运行全量回归、桌面、构建、安装升级或发布；人工 review 尚未进行。本轮更广泛的系统可持续性评估仍需结合后续逐模块阅读，不能以无环或本片测试代替。

## 2026-11-16：标准上移 docs，解除对具体方案的反向引用

- 来源：用户要求 docs 不引用 design，并允许标准、规范和准则迁入 docs；本步仅调整文档，不实施源码重构。
- 将原通用架构标准和治理流程迁为 [06](../docs/06-通用项目架构设计规范与原则.md)、[07](../docs/07-架构治理规范与治理流程.md)。原治理附录单独保留为 [CBIM 项目映射与整改基线](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/cbim-architecture-governance-baseline.md)，历史基线与验收内容保留，实时任务仍归 Issues。
- 清理 docs 01–05 对具体产品方案、运行资料与验收报告的依赖，改为自包含的目标和验证边界说明；保留未实现不冒充完成、概念不授权运行等限定。同步协作规范、导航、三宿主入口及历史记录中的迁移链接；历史执行事实未改写。
- 验证：`git diff --check`、Python 检查 docs 全部正式相对链接与无 design 引用、三宿主入口一致及迁移文件存在性。仅文档变更，未运行产品测试、类型检查或构建；未提交或发布。

## 2026-11-16：工程文件组织与代码阅读设计落档

- 来源：用户直接要求，基线 `bda7f5cb`；查询开放 Issues（上限 200，实际 3 项），没有对应工程组织工单，未创建或修改其他工单。
- 将设计落到 [docs/05](../docs/05-工程文件组织与代码阅读设计.md)：文件头说明形式/职责/意图；private、protected、public 依次分区，字段/属性/构造/方法细分，每个成员中文注释；目录按内聚系统封装列出可点击文件清单、逐类设计意图、接口契约、开闭边界与子封装导航。
- 用户最终选择无状态工具统一静态类，覆盖先前保留函数形式的选择；有状态队列/服务保持实例，React/宿主入口保留框架语义。新增静态工具类、实例类和目录说明模板；保留初始化顺序、this、回调身份与消费者迁移要求。
- 同步 AGENTS、README、设计导航、治理资料归属与三宿主开发/架构入口，解除 docs 仅限四份文档的旧限制。资料采用同一权威来源，不复制设计正文。
- 验证范围为文档：运行 `git diff --check`，使用 Python 核对三宿主入口字节一致、设计文档正式相对链接存在及 Markdown 代码围栏配对。模板内示例链接是明确占位，不作为真实源码声明。
- 完成的是设计与规范落档。源码重构、718 个 TypeScript/TSX 文件的逐成员 review 与全部模块说明尚未实施；未运行产品测试、类型检查、构建、全量 CI，未提交或发布。已有品牌与领域引擎草稿保持原状。

## 2026-11-16 — #94 递归调用产物基线与完整清单报告

基线 7f2ceb17。真实输出清单迁移后暴露 TASK_NOT_FOUND：报告只查旧图任务，新业务登记已存在仍不可读。ArtifactReportService 与 OutputManifestReportService 增加独立 inspectAgent 端口并读取原 agentBusinessRuns，装配复用已有按协议固定路径的 inspectMember。没有合成 TaskNode/DispatchRun、模型或派工记录。

C2/L1：共同变化是只读报告的递归来源身份，新增 recursive-evidence-source 只核唯一根/周期/登记及 canonical 的原父调用、模块、岗位、原生通道、连续事件。旧报告与新报告的来源选择显式区分；文件对比、范围完整性、读占用、哈希和输出脱敏仍由原服务负责。active 仅表示原启动意图，可列已确认引用但不放行当前文件复核；closed 仍须与真实日志终态配合。读取后登记或日志变化保持不可核实；不修复旧日志或自动重放。第五问未新增通用规范候选。

真实 Pi 完整清单/选定文件各 complete 与 stop 共四项迁为一主一子；保留真实 read、捕获成功先后顺序、捕获回执不作步骤证据、文件新增/移动/删除检测、重开相同报告与原字节不变。日志夹具新增显式协议参数，其他旧调用默认路径不变。测试中的主结束只说明对话完成，不签署人工验收。

验证：
- output-manifest-pi 初次完整场景因 TASK_NOT_FOUND 失败，定位后补产品；原两报告服务 13/13 通过。产品修复后的首次真实两项走到夹具旧日志路径 ENOENT，再改为明确 loop-engine 路径，未改产品回退路径。
- pnpm exec vitest run tests/output-manifest-pi.test.ts（build/recursive-manifest-fixed.json）：2/2 通过。
- pnpm exec vitest run tests/artifact-baseline-pi.test.ts（build/recursive-artifact-baseline-fixed.json）：2/2 通过。首次测试误从只返回 scopes 的夹具取 runs，改为直接检查实际 Store 为空。
- 新递归报告反例 pnpm exec vitest run tests/output-manifest-report-service.test.ts tests/artifact-report-service.test.ts -t recursive（build/recursive-report-identity.json）：2/2 通过，覆盖跨父调用/原生/模块、协议缺失、坏尾、active、读取中变更、跨根和重复登记；旧 13 项已有本切片通过证据，无永久跳过。
- pnpm typecheck、pnpm check:test-modules、pnpm check:architecture 通过：1661 文件/7905 依赖、无环无违规；相关文件头、端口注释、evidence/runtime 和 application/assembly 契约及三份生成类图已同步。
- 未执行共享旧桌面脚本、安装升级或发布；完整 CI 43790338820 正运行旧提交 ee9c3047，不代表本切片已通过全量检查。

## 2026-11-16 — #94 Workflow 启动预检接入递归链路

基线 b9849f52。迁移真实 Workflow 四场景时，正常、停止、并发证据均通过；缺能力场景发现新递归调用绕过了旧 MemberExecutionManager 的启动能力检查，只读权限仍启动要求 write 的模型。这是产品缺口，未通过更改预期或放开权限解决。

S1–S7 简要：本次限 Logic 规则/启动装配，C2/L1。规则由 workspace/rules/workflow-contract 的 assertWorkflowCapabilities 持有，旧成员与 createWorkspaceLoop 两个真实消费者复用。可信装配提供当前引擎、权限和实际范围/验证端口；缺能力在受管引擎准备、运行登记和模型请求前拒绝。保护现有 LoopRuntime、权限策略、DispatchStore 和验证算法，不新增调度或生命周期。四问：语义为冻结 Workflow 能否在当前能力下执行；来源来自原准备/可信端口；状态仍属于原运行；共性是同一能力条件和错误码。第五问未发现需新增的通用架构规则。后续新增验证器只更新能力声明和实际端口，不改通用循环。

测试迁移为 cbim_agent_call/result_check，审批集中主对话；旧图为空。保留计划前拒写、审批前无文件、仅 write 不可交付、实际 read 证据、并发旧 read 失效、停止和重开无重放。八种日志篡改反例仍执行既有验证器；输入投影取自真实业务登记/原日志，与生产 agent-business 的私有投影一致，不持久化伪造旧图。主循环 completed 不声称缺能力业务完成或人工验收。

验证：
- 初次 workflow-condition 四项：3 通过/缺能力 1 失败，保留真实问题证据。
- 修复后 pnpm exec vitest run tests/workflow-condition-pi.test.ts -t missing-capability（build/recursive-workflow-preflight.json）：1/1，通过前模型请求与业务登记均为零。
- pnpm exec vitest run tests/workflow-contract.test.ts tests/workflow-runtime.test.ts tests/agent-call-assembly.test.ts tests/application-runtime.test.ts（build/recursive-workflow-capabilities.json）：35/35 通过。
- 新增隔离能力规则用例 -t '显式隔离范围'（build/workflow-capability-scope.json）：1/1 通过，不回退原生工具。
- pnpm exec vitest run tests/member-execution.test.ts tests/workflow-condition-pi.test.ts（build/recursive-workflow-consumers.json）：25/25 通过，包含旧入口 21 和真实递归 Workflow 4；源码变化后重新验证消费者。
- pnpm typecheck、pnpm check:test-modules、pnpm check:architecture 通过；1660 文件/7893 依赖，无环/无违规。首次类型验证提示测试传了模型目录项，已改为真实 resolve 的冻结模型快照。
- 三处源码注释及 workspace/rules、team/runtime、execution/assembly 的 CONTRACT/ARCHITECTURE 已同步。共享 workflow-condition-ui-smoke 仍使用旧页面/图定位，未冒称桌面验收通过；后续发布须迁移并实际验收。新 CI 43790338820 尚运行于 ee9c3047，不含本切片。

## 2026-11-16 — #94 仓库只读工具新主调用协议

repository-tools-provider 识别当前 cbim_agent_call 并拒绝旧 cbim_dispatch_task。新主 Agent 也可执行任务，不再以“不列出 write/edit/bash”充当角色权限断言；实际授权仍由 permission=read 和工具策略控制。五个真实 HTTP 集成保留资源 scope、真实内容 hash、撤销/服务代次变化后的内容不回流、停止、未授权不列工具、历史脱敏和重启不重放，没有替换网络结果或删减这些断言。此测试范围验证仓库读取，不声称覆盖原生写工具拒绝；该权限边界由现有执行策略用例负责。

pnpm exec vitest run tests/repository-tools-pi.test.ts --reporter=default --reporter=json --outputFile=build/recursive-repository-tools.json：5/5 通过。共享桌面脚本沿用同一 provider，但此次未运行桌面验收。仅变更测试选择协议，无公共类型、源码或测试归属变更，不重复产品静态检查。完整 CI、安装升级与发布仍未通过。

## 2026-11-16 — #94 原调用求助经主 Agent 转交用户

question-tool-contract 的四种真实 Pi 情况迁入同一主运行：主偏好问题 → cbim_agent_call → 子 Agent 原调用 waiting → 主 Agent 向用户转交原题 → cbim_agent_reply → 原子执行继续。子 Agent 没有独立用户问题卡；旧 dispatch.questions/answerQuestion 拒绝该身份。取消问题返回 cancelled 并由父级转交，与停止整个任务不同；坏回包仅在真实答案已消费后注入，保留 TOOL_OUTPUT_INVALID 和不重问。主/子原日志、唯一登记、实际文件证据、重启不重放仍检查。

问答回执不能完成业务步骤，真实 read 回执才可进入步骤证据与 delivery。退出旧 goal_plan/goal_review 二次主轮；result_check 核验不冒充人工验收。旧 GoalTools 严格证据校验仍由原服务/契约套件负责。此次只改测试，不修改产品行为。

验证：
- pnpm exec vitest run tests/question-tool-contract-pi.test.ts --reporter=default --reporter=json --outputFile=build/recursive-question-relay-fixed.json：stop 通过，其他 3 项因夹具错误假设证据错误码必须包含 EVIDENCE 失败；实际工具明确返回“证据不存在、已过期或不属于本轮”。
- 改为匹配实际拒绝语义后，-t 'complete|cancel-question|invalid-output'（build/recursive-question-relay-answers.json）3/3 通过。四种情况各有通过证据，无永久跳过；初次误将旧入口当空列表的错误也已改为明确拒绝断言。
- pnpm typecheck、pnpm check:test-modules 通过。完整 CI /桌面安装升级/合并发布未通过。

## 2026-11-16 — #94 修复递归业务 Agent 历史归档与重开

基线 ac264383，CI 43786781920 的 main-session-instance-pi 仍等待旧二次主轮。迁移该真实 Pi 场景后暴露产品缺口：AgentHistoryService、索引契约和 WorkspaceRuntimeMonitor 都把 memberBinding 等同于旧 dispatch/runs 路径，导致新 loop-engine 业务子运行归档失败、全局 complete=false。

新实现保留 journal 原路径，通过严格原 agentCall 引用区分新递归业务：业务子记录仍是 task/member/registered，但 journal=loop；索引增加可选引用，旧记录形状不补写。增量、重开和正文读取都核对同一引用，不允许更换父身份或把旧目录伪装成新日志。agents/contracts 统一格式与当前子身份校验，budget 的引用格式复用它；父授权和周期归属仍由用量服务核对。没有引入新的历史服务或扫描机制。

真实场景保留独立主/子实例与原生文件、私有主上下文不传给子、实际文件读取/候选证据、准确回原主工具、旧执行入口不可复活、用量只计一次、重开原履历与正文不变。新流程 2 主请求+5 子请求、2 个运行，共 770 tokens；原 3 运行/11 请求退出，计量算法不变。重开后的工作区对象重新取得，未使用已关闭旧 store。

验证：
- pnpm exec vitest run tests/main-session-instance-pi.test.ts -t 'explicitly registered' --reporter=default --reporter=json --outputFile=build/recursive-main-instance-fixed.json：1/1 通过，含真实 AgentHistory.runs/events 查询及重开一致性。初次验证的归档错误保留在诊断输出，未放宽 complete 断言。
- pnpm exec vitest run tests/agent-history-store.test.ts tests/agent-history-assembly.test.ts tests/scope-usage-service.test.ts --reporter=default --reporter=json --outputFile=build/recursive-history-contracts.json：30 通过，新增两个正向夹具因遗漏业务 moduleIds 失败；补齐实际模块身份后 -t 'recursive|changed parent'（build/recursive-history-new.json）6/6 通过。四个反例也一起重跑，保证不因夹具身份先失败形成假阳性。
- pnpm typecheck、pnpm check:test-modules、pnpm check:dependencies 通过；1660 文件/7890 依赖无循环违规。node scripts/source-architecture.mjs --check 通过；不重复相同依赖检查。
- agents、history/runtime、team/rules、application/assembly、budget/runtime 契约、相关代码注释和生成类图同步。完整 CI /桌面安装升级/合并发布未通过，不以此部分通过替代。

## 2026-11-16 — #94 补齐递归运行的周期用量统计

基线 a60a9be3。真实缺口：ScopeUsageService 原只枚举旧图成员，遗漏 agent-tools-v1 的子运行；FileRunStorage 的活动主运行也可暂显示 interrupted，不能据此认为不在途。本切片仍由 Logic/budget 持有只读计量规则，Application 注入固定 loop-engine 日志读取端口，dispatch 只装配；不创建第二个预算账本或修改预算准入。

从 scope.runTracking 的可信主运行出发，逐层核对已授权 cbim_agent_call 首次引用与子 run.started.agentCall，支持普通和显式业务递归；业务子运行还匹配同 scope 的持久 agentBusinessRuns。无终态的主/子都计为在途。跨根、矛盾、循环、重复来源及缺日志不能使报告完整；总来源超过 532 拒绝报告，不截断数字。旧任务/成员计量入口保留。类型 ScopeUsageLogs 的 inspectAgent 独立于主证据端口，未放宽 inspectMain 的主身份校验。

验证与边界：
- pnpm exec vitest run tests/scope-usage-pi.test.ts tests/scope-usage-service.test.ts --reporter=default --reporter=json --outputFile=build/recursive-scope-usage.json：7/7（真实 Pi 1 项 + 原计量服务 6 项）通过。第一目标新协议为 1 主+1 子，实际供应商 2 主请求+5 子请求，总 input=1200/output=240/total=1440、估价 0.00168 USD；第二目标独立且重启后不变。请求数减少源自退出旧规划/结果审阅轮次，未修改价格或计量算法。
- 新增递归服务用例 7 项：三层精确归属、父引用未授权/跨根/冲突、子头跨调用、活动/缺日志、重复/环、业务绑定无登记、来源超限。第一次选取新增 5 项有 4 项通过，子头反例因测试夹具共享父子引用失败；修正夹具独立快照后 -t 'child header|business-bound|too many' 的 3 项通过。13 项服务测试各有通过证据，无永久 skip。
- pnpm typecheck、pnpm check:test-modules、pnpm check:architecture 通过；540 文件测试归属不变，1660 文件/7889 依赖无循环或违规。
- 源码注释、budget/runtime、dispatch/runtime、application/assembly 契约及其生成类图（含 logic 上层关系）同步；本切片未验证真实在线模型账单、桌面安装/升级、合并或公开发布。其余缺口继续归 Issue #94 / PR #96。

## 2026-11-16 — #94 主调用登记与回执丢失验证迁移

基线 4368d947。main-tool-contract-pi 的正常回流/停止迁为单个主运行的 cbim_agent_call 和 result_check；不再等待旧 goal_plan/dispatch_task/member-results 二次主轮。旧坏规划/派发回包场景迁为新链路的业务登记已保存后回执丢失、父工具关联已 fsync 后回执丢失。故障只注入真实保存之后，验证唯一原关联/登记、子引擎未启动、unknown 且禁止重试、关闭释放以及重启日志/请求计数不变。正常场景保留真实成员读取和交付证据；停止场景保持原子运行未完成。

原 GoalTools/DispatchTools 的严格坏回包验证继续保留在 main-tool-output-core（15 项）及 main-tool-output-service（2 项，真实事务），未删除旧记录兼容覆盖。新调用失败工具回执 outcome=failed 表示工具报错，独立 ToolOutcome.status=unknown/retryable=false 表示执行影响不能推断；不能混为安全重做。

实际验证：
- pnpm exec vitest run tests/main-tool-contract-pi.test.ts tests/main-tool-output-core.test.ts tests/main-tool-output-service.test.ts --reporter=default --reporter=json --outputFile=build/recursive-main-receipts.json：旧输出 17 项及停止 1 项通过，三个新断言失败。
- 修正从实际 steps.evidence 取证、依据原错误对象及独立 ToolOutcome 断言后，-t 'complete|lost-'（build/recursive-main-receipts-faults.json）正常 1 项通过；-t lost-（build/recursive-main-lost-ack.json）两种回执丢失 2 项通过。四个集成场景各有通过证据，选择器排除未修改已通过用例，无永久 skip。
- pnpm typecheck、pnpm check:test-modules 通过；540 文件归属不变。仅测试/夹具改动，无产品源码或架构变更。
- 全量 CI、桌面安装/升级与公开发布仍未完成；其余迁移仍归 #94。

## 2026-11-16 — #94 原调用问答发布快照隔离

基线 50a1f285。Logic/agents 的 AgentCallExchange 原先把自身持有的原题、已校验答案直接传给异步 publish；适配器可在记录后修改同一对象，影响后续校验或唤醒值。现在只向发布端传递 structuredClone 快照；状态仍由同一个 Exchange 持有，调度、循环、持久化归属不变，不增加服务或层级。

验证选择：exchange 的 5 项单元覆盖连续问答、重复答案、发布失败、发布端修改、取消与落盘回执丢失；scheduler 20 项与 assembly 15 项验证其真实直接消费者，包括递归及跨模型同调用暂停。命令 pnpm exec vitest run tests/agent-call-exchange.test.ts tests/agent-call-scheduler.test.ts tests/agent-call-assembly.test.ts --reporter=default --reporter=json --outputFile=build/recursive-question-isolation.json：40/40 通过。pnpm check:architecture：135 份文档同步、1660 文件/7886 依赖、无循环或边界违规。首次 typecheck 发现测试替身遗漏 cancelled 答案分支，已修正为生产端口参数类型并显式收窄；再次 pnpm typecheck 通过。

源码文件头已有职责说明，更新类注释及关键发布点注释；同步 agents/CONTRACT.md，生成 agents/ARCHITECTURE.md。当前仍不实现重启自动恢复暂停；未知结果继续不得重放。全量 CI 和发布验收另行完成。

## 2026-11-16 — #94 成员坏回包验证迁入原调用问答

基线 639948f3，Issue #94 / PR #96。迁移 member-tool-contract-pi 两项真实 Pi 集成：只读后求助、写入及真实基线采集后求助。确定性供应商通过 cbim_agent_call/cbim_agent_reply 执行，同一个子 task/run 内暂停和回答；QuestionTools 的实际 request 已消费父级答案后，仅损坏传给严格输出包装器的返回值。

保留验证：原问题与正确答案只记一次、错误输出不泄漏损坏字段、原生会话记录 TOOL_OUTPUT_INVALID、实际 read/write 与基线采集、未准备交付时不得得到 verified、无旧派工图/第二成员运行、重启后文件时间/原生与 canonical 日志/问答请求计数不变。新设计不再要求旧 task.help_requested/task.checkpoint_requested 暂存后结束轮次；写后“checkpoint”场景现在是原调用内问答，不能据此宣称已支持跨进程恢复等待。

测试夹具显式冻结含文件范围和交付证据要求的 Workflow，避免无约束 Workflow 的结构核验被误当作交付要求；采集版本读取真实 cbim_task_inspect，不硬编码写前 plan.version。公共 seedMainToolContract 新增可选 Workflow 正文参数，原消费者缺省行为不变。

验证：
- pnpm exec vitest run tests/member-tool-contract-pi.test.ts --reporter=default --reporter=json --outputFile=build/recursive-member-output.json：help 通过，checkpoint 暴露旧固定版本并失败。
- 修正为真实 inspect 版本后 pnpm exec vitest run tests/member-tool-contract-pi.test.ts -t checkpoint --reporter=default --reporter=json --outputFile=build/recursive-member-output-checkpoint.json：checkpoint 通过；help 未重跑，按明确选择器排除。两项各有通过证据，无永久 skip。
- pnpm check:test-modules：540 文件边界通过，归属不变。本切片未修改产品源码或架构依赖。
- 全量 CI、桌面安装/升级、合并与公开发布尚未完成；其余迁移仍跟踪 Issue #94。

## 更早的开发记录

2026-11-15 及更早的原始记录从[清理前固定版本](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/development-log.md)查阅；日期、验证数字和限制均以原文为准，不作为当前任务清单。
