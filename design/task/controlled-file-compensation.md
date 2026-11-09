# 受控单文件写入与独立显式补偿

Step37 / R03-C。状态：2026-11-08 约定范围已完成，承接提交 5ccae12；见[验证报告](../verification/controlled-file-compensation-20261108.md)。Step36 的原影响观察、明确处置和独立新修复；本片为文件通道建立真实写前正文及独立补偿，不将任意副作用视作可撤销。第 9 组仍仅计划。

## 用户可见结果

正式执行成员可调用 `cbim_file_write_controlled`，在核对旧内容后替换一个现有业务文件。工具只有在写入与结果可靠保存后返回成功。用户可从该成员原调用查看操作状态，明确预览并恢复写前内容；原工具失败、原操作已应用、新补偿已应用分别显示。重开只读历史，不自动继续或重复写入。

主 Agent 不安装该业务写工具。read 权限拒绝；ask 通过真实审批，execute 沿既有权限。成员须有当前可信 claim、岗位/模块及冻结运行身份；本片不放宽其它执行或知识保护。

## 首片支持与限制

仅本地 Windows NTFS 上已有、普通、单硬链接、非 reparse 的 UTF-8 文件默认数据流；写前及新内容各最多 1 MiB。保留 BOM、CRLF 与实际字节，拒绝无效 UTF-8/未配对代理字符。不新建、删除、移动文件，不操作目录、ADS、设备、UNC、云盘或受管 `.cbim`、`.git` 和应用数据。

旧 native write/edit/bash 没有真实 before，不补造备份；任意命令、外部服务、知识事务仍保留各自支持矩阵，不能因本片完成宣布 R03 全部完成。专业 Workflow 的原生工具条件、成功产物来源及检查点白名单不自动扩大，新工具后仍须真实读取/采集/验证。

独占句柄约束普通数据访问，不是全系统沙箱；metadata/hardlink 变化仍需检查。只读映射可能造成写入前缀成功而截断失败，必须记录部分写入未知。文件恢复不还原时间戳、ACL、其它流或外部观察，不保证断电原子性。

## 协议与领域边界

公共纯叶子 `controlled-file-operation.ts`：严格工具输入/输出、原操作报告、补偿预览、提交、原回执及上限。私有纯叶子 `controlled-file-event.ts`：真实 origin、file identity、blob 引用和不可变阶段；Bridge 不导私有对象。规则和 Store 不变量分文件维护。

工具输入 `{path, expectedBefore:{byteLength,sha256}, content}`。expectedBefore 只是 CAS，不是备份。operationId 从可信 workspace/root/task/run/toolCall 派生；运行及授权序号来自 Runtime，模型不能提交权限或证明。成功输出只含 applied、固定运行/调用/路径/内容摘要及 `acceptance:not_evaluated`，不返回正文、native 路径或 blob。

私有 before/intended-after 由实际句柄字节保存并核 hash；操作记录只存引用。新增 DispatchStore 可选附录 `controlledFileChanges`，每次恰一条阶段追加，不与图、周期、岗位、知识或处置 mutation 混写。旧缺省不补数组，原日志与图/周期游标保持。

阶段为 `prepared(1) → executing(2) → applied|unknown(3)`；仅真实执行方能确认未发出第一次内容写时，可从 prepared/executing 保存 `not_applied`。终态不可改写，unknown 不升格成功。prepared、executing 或终态保存未确认时，保留原阶段并只查原操作；不得通过新命令自动续写。

工具失败后的本轮屏障独立于在途短锁：换调用 ID 仍不能写、运行命令、交付或停泊，只保留固定只读工具、计划查询和暂存求助。可信原 not_applied 与实际退出才解除；其余情况最终 interrupted，原 failed 回执和账本事实保留，求助不进入可消费交接。

每 run 最多 8 原写、每 root 最多 64 操作、每工作区最多 256 操作、每原写最多 8 补偿意图；每操作最多 3 阶段，元数据总计最多 16 MiB且提前预留终态空间。私有 blob 总计 64 MiB，含已写但未建立意图的孤立文件，不自动丢弃历史腾空间。公共输出最多 128 KiB；严格输入 JSON 最多 3 MiB，并受正文 1 MiB 与现 Pi bridge 4 MiB wire 限制，不放大旧桥接上限。

## 原操作查询与补偿

四个桌面入口：`dispatch.controlledFileReport`、`dispatch.fileCompensationPreview`、`dispatch.fileCompensate`、`dispatch.fileCompensationReceipt`。只操作已打开工作区，原报告按 workspace/root/task/run/toolCall 定位，无 operationId 也能查询。查无记录不等于未执行；报告不读取当前文件或自动打开 worker。

补偿仅允许原 member_write 已可靠 applied、原 scope 已关闭、原 run 无在途、无冲突占用、当前同一文件身份/单链接/字节仍等原 after、原 before 完整。原 prepared/executing/unknown 不直接补偿，走现有显式核实/新修复。预览不保留句柄，提交重新独占打开并核全部依据。

提交只传原 operationId、稳定 commandId、预期操作/补偿版本、basis、reason 和工作区实例；目标路径/恢复正文只能从原记录取，actor 由本机入口注入。新补偿另建阶段链，原操作不变；已有成功或未决补偿禁止再建第二条恢复，同命令异参拒绝，同命令只返回已保存事实、不推进中断阶段。

补偿不启动模型、不产生业务交付证据、不撤销人工意见。界面发送前保存完整原请求；已发送未知只查询同命令，不换 ID 重试。精确事务前拒绝可以重新预览，存储/IO/CAS/丢回包保持未知。所有操作显式点击，挂载/重开/轮询不发送写、读文件或模型请求，草稿与队列独立。

## 平台与运行生命周期

每次操作独立 Electron utilityProcess，固定专用 entry、最小环境、空 execArgv；子进程持全部目录/文件句柄，在同一线程同步调用 Win32 并立即取错误，Main 保持响应。Core/Scheduler 不持 HANDLE，worker 不导 Application、Store、模型或知识。

私有消息固定 token、顺序及阶段：open/read → recheck → 一次 apply → close。Main 先保存两个 blob、prepared/executing，再准许唯一 apply；同句柄写、截断、flush、读回并核 identity。未收到结果不能判断没写，退出码0也不证明成功；不自动重新 fork 或重放。

固定锁序：先原命令只读查找 → 本应用占用/短门闩 → 文件及目录句柄 → blob IO → 短 Store 准入 → 实际文件 IO → 短 Store 终态 → 确认句柄关闭/子进程退出再释放。Store callback 不等文件、知识或模型队列；成员复用已持写租约，桌面补偿独立获取。

停止同步撤销后续准入，已发送 apply 必须等待实际结果/子进程退出，不能先释放占用让旧 IO 后台继续。强杀或父退出只保证该版本实测的句柄释放，仍按持久阶段保留未知；重开只重放记录，不启动 worker。平台缺能力明确不广告/拒绝，不退回 Main 同步文件写。

## 实施与验收

1. Core/Store：严格协议、身份、原命令、不可变阶段及容量；并发补偿 CAS、重开/损坏/混合写拒绝，旧前缀逐字保持。
2. Runtime/Main：真实成员工具、审批和一次性授权；私有 blob、utility entry、可靠写和补偿、关闭排空；修订构建配置并验证 Koffi 最终打包。
3. Bridge/UI：成员原调用报告、显式预览/补偿及原命令持久查询；旧 native 不提供伪恢复按钮，迟到回包不改变目标。
4. 单元/实际平台：UTF-8/BOM/CRLF/缩短/空内容、已有句柄、只读映射部分写、hardlink变化、blob失败零目标写、停止/child退出、applied丢wire、外部漂移拒补偿、原补偿丢回复不重写。
5. 真实 Pi 与最终 Windows EXE：正式成员受控写并保存 applied 后丢回包→原报告→用户明确补偿→before exact→重开零重放；另场漂移/真实partial保留unknown且不可补偿。分别记录工具、操作和补偿事实，页面/通信错误与原字节核对。确定性供应商不代替在线业务判断。

每步同步中文注释、CONTRACT、目录类图与路线图；对应测试和真机通过后独立本地 Git 提交。第 1–8 组剩余工作继续按 R01–R17 推进，不进入第 9 组。
