## Windows 隔离 Node 平台端口（R12-A）

`runIsolatedNode` 是可信宿主的平台端口，正式成员经冻结范围与可靠生命周期装配后调用。它不从业务请求取得宿主路径或环境变量：最多64份、总8 MiB的明确字节快照复制到本次 input；当前宿主可执行器及 Electron 必需数据复制到 runtime 并记录实际哈希；程序只向私有 output 写入，不修改原工程 ACL 或自动回写。

Windows x64 使用唯一临时 AppContainer profile、LPAC opt-out 和固定 `registryRead` capability。该能力用于 Node 的实际系统初始化；没有任何网络 capability、COM授权或宿主凭证。ACL只对新建的自有目录设置：input/runtime读执行，output修改；保留Windows自身授予LPAC及registryRead的系统对象权限，不能声称绝对不可访问所有外部对象。原生旧工具仍仅有既有门禁，不因新增端口而自动隔离。

`CreateProcessW` 带挂起及 Job List 属性，线程恢复前核 AppContainer、精确Package SID、唯一能力与原Job成员。Job不允许breakaway，最多1–8进程、128–1024 MiB提交内存及累计用户态CPU期限；宿主按单调时钟最多30秒终止，取消、主进程退出仍有后代及输出超限均收束原Job。只有原主进程已退出且Job活动数为0才读取输出；宿主崩溃由不继承的Job最后句柄关闭触发后代终止。没有磁盘硬配额，内核peakMemory计量可能包含失败的提交尝试，不等于RSS或成功分配量。

仅继承NUL输入和宿主输出管道的显式句柄清单，不继承任意可继承句柄。清理环境只保留AppContainer启动所需的用户／系统位置及私有TEMP，不传PATH、NODE_OPTIONS或密钥。Windows参数逐项编码，不经过shell；保留Node symlink标志避免普通模块解析要求读取未授权父目录，不扩大文件权限。

当前宿主是 Electron 且实际执行器为同一二进制时，使用 `--no-stdio-init` 复用宿主预置的标准流，避免 Electron 额外以读写方式打开 NUL 而在部分 Windows LPAC 环境启动失败；普通 Node 不接受该参数，不添加它。脚本自行派生后代时仍受同一 Job 和系统权限约束；验收后代使用 `stdio:inherit`，Electron 后代明确带该参数，不依赖 `stdio:ignore` 重新打开设备，也不新增系统对象授权。[Electron 对应实现](https://github.com/electron/electron/blob/v40.10.6/shell/app/node_main.cc)。

stdio最多64 KiB；声明输出最多32项、单项1 MiB、总4 MiB，进程树结束后逐层核非链接目录及同一普通单链接文件句柄。状态、实际退出码、输入／执行器／输出哈希和内核计量分开返回；`exited`仅表示进程结束，非零退出不能当成功，任何输出自述不证明业务验收。Profile删除或句柄／Job排空失败拒绝交付；原进程退出后映像仍被系统短暂占用时，只对同一自有目录的清理作有界重试，不重跑脚本；owner最后删除，持续失败保留依据。孤儿owner记录只供核实原资源，不授权重放。异常宿主退出后的自动孤儿清理及任务级接线留给R12-B。

官方依据：[LPAC启动](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[进程属性](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)、[Job限制](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)、[Job实际计量](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)。其他平台、不支持API或资源缺失明确失败，不降级普通命令执行。

### 有界业务文件观察

`ArtifactFiles` 固定当前工作区根和所有者有效性检查，供成员采集与显式历史复核共用。`normalizeArtifactPath` 仅做路径格式匹配，保持相对文件名大小写；实际读取逐级核对真实路径、普通文件、句柄身份和读取前后元信息。目录、越界、`.cbim`、设备路径、备用数据流、符号链接、目录联接及硬链接均拒绝。

一次最多 16 个文件，单文件最多 8 MiB，整次实际读取最多 32 MiB。复核中的每个文件及失败前已读字节共用总额度，不因逐文件捕获错误重新计数。超过上限不截断作证；端口只返回路径、长度、SHA-256 与受限错误，不返回正文或运行命令。

AbortSignal、工作区退役与文件变化在异步读取期间持续核对，句柄在 finally 释放。读占用阻止本应用的业务写入竞争，文件系统外部竞争只能尽力发现；这不是操作系统沙箱、全工作区扫描或原子产物快照。

### 同字节 JSON/CSV/PNG 验证

`ArtifactFiles.validateFile` 复用安全打开与读取循环，但单文件上限收紧为 1 MiB。同一次句柄读取的字节同时产生 SHA-256 和受限解释器输入；先与明确基线的路径、长度和哈希一致，再严格解析 UTF-8/JSON 与冻结 Schema。无二次打开、命令、网络引用或脚本编译，返回指纹及有界判定，不返回原文或对象值。

语法、重复键和结构不符合产生 `rejected`，这是验证已经执行的事实；文件缺失、基线变化、超限、读取竞争或停止产生错误，不伪装结构拒绝或通过。原采集的 8 MiB/32 MiB 限额及不保留正文行为不变；交付与审阅使用同一个 `checkFiles` 端口重新核对通过时的字节。

### 私有原生会话指纹

`NativeSessionFiles` 固定当前成员运行的受管 Pi sessions 根，只接受调度保存的 nativeSessionId/sessionFile。逐组件拒绝越界、链接、Windows ADS/设备名/尾点空格歧义，文件须为单硬链接普通文件。逐块读取最多 64 MiB，读取前后句柄/路径身份和元信息一致才返回长度及 SHA-256，不返回正文。

原生 JSONL 必须有效 UTF-8、完整换行、对象行和匹配的 session 头，最多 100000 行；null/数组/截断或错身份均明确拒绝。AbortSignal 与工作区有效性贯穿读取。指纹只供检查点私有证明，不成为公开文件查询、任意历史恢复或文件系统原子锁。

### 无基线的当前文件观察

`ArtifactFiles.observeFiles` 复用同一安全文件读取，每次最多 16 个路径、每文件 8 MiB、共享 32 MiB，只返回 present/missing/unverifiable、长度和 SHA-256。路径由 Scheduler 已核原调用推导，平台再次拒绝越界、链接、硬链接、设备和受管知识路径；不接受 UI 任意路径，不输出正文。取消或工作区失效终止读取，前后身份变化不交付确定哈希；此观察不证明原操作成功，也不生成成功产物基线。

## 受控单文件写入与显式补偿

utility entry 允许在 app.asar 中，进程 cwd 必须通过 original-fs 解析为 process.execPath 所在的真实目录。不能将 ASAR 内虚拟目录交给原生进程，也不以业务工程为 cwd；目录不可用在 fork 和任何文件意图保存前拒绝。

受控文件能力仅由 Electron 桌面装配，独立 utilityProcess 在同一线程持有 Win32 独占句柄。普通 Node 宿主没有该能力。只允许现有 UTF-8 普通单文件；原 native write/edit 不因此获得自动撤销能力。

Runtime 在自己的 beforeTool 可靠保存 allowed 后签发一次性授权，短门闩排除其它工具/审批；模型与 emit 事件不能签发许可。Main 在 Store 外取得文件句柄和可靠 before/intended-after 私有备份，单条 prepared→executing→terminal 附录由唯一 Store 保存。只有可靠 applied 返回成功；进入 executing 后的 IO/截断/进程退出均可能部分写入，不自动回滚或重发。

停止先中断原进程，排空实际文件操作并确认 child 退出后才释放工作区占用。退出码不证明写成功。补偿是桌面明确提交的新命令，仅原 applied、原周期已关闭、当前同一文件仍等于原 after 才可恢复保存的 before。原日志、unknown 和原操作不改写；原命令查询先于今日配置，任何保存未知只查原记录。

## 完整目录清单读取（R07-A）

`OutputManifestFiles` 从冻结范围完整枚举文件与目录，缺失根明确记录；两次完整扫描共用15秒期限，摘要一致才返回。每次最多512条、32层、单文件8 MiB及总计32 MiB，无忽略或分页截断。文件复用真实句柄指纹，目录前后核身份和元信息；链接、硬链接、特殊对象、范围外路径或不稳定读取失败，不返回局部清单。显式复核重新枚举整个范围，新增条目也使旧依据失效。外部竞争仅尽力检测，不宣称操作系统隔离或原子快照。

## 受控文件命名空间操作（R07-B2 平台端口）

`withExclusiveTransition` 在 open 时固定删除或不覆盖移动，和内容替换共享真实 utility 退出屏障，但不能在同一会话互换操作。当前限 Windows x64 / NTFS、已有普通 UTF-8 文件和已存在父目录；单文件 1 MiB，拒绝链接、硬链接及默认流外的其它数据流。移动两端父目录均持句柄，不创建目标父目录，不覆盖目标；平台事实含原文件身份/字节与源已缺失。

删除使用 `SetFileInformationByHandle(FileDispositionInfo)`，关闭原文件句柄后核缺失；移动使用 `FileRenameInfo` 且不设替换标志，同句柄核目标身份/字节及源缺失。发出请求即记录 writeIssued，取消/断桥/回包丢失不等于未操作。调用方仍须先可靠保存执行意图，并等进程退出后核完整集合；平台成功自身不签发业务验收或重试许可。官方结构依据：[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)、[FILE_STREAM_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_stream_info)。

`ArtifactFiles.validateTable` 复用同一安全打开、句柄读取及路径前后核对，把同一次 ≤1 MiB 读取同时用于 SHA-256 和 CSV 解释器。原基线不匹配、链接/硬链接/越界、读取中变化、停止或工作区失效均拒绝；单元格值只在本次内存解析中存在，不进入验证诊断。JSON/CSV/PNG 方法各用自己的冻结参数，无回退解释。

### 有界 PNG 像素解码

ArtifactFiles.validateImage将同一安全句柄得到的≤1 MiB文件字节同时用于原基线指纹和png-validator。后者逐块核签名、长度、ASCII类型/保留位、CRC和顺序；仅支持IHDR、连续IDAT、末尾IEND及前置唯一sRGB/gAMA/pHYs，元数据长度、整数范围及sRGB/gAMA一致性也核验。其它块、APNG、调色板、灰度、16位或交错明确拒绝。

完整IDAT合并后用Node inflateSync的maxOutputLength与info核准确解压长度及已消耗输入，拒绝截断、压缩尾随数据或膨胀超限；五种行过滤器按实际邻接像素还原，每行过滤值须有效。宽高各≤4096、总像素≤1048576、块数≤1024，像素仅留本次平台内存，验证回包只含原条件诊断。解码完成后再核停止与所有者；不承诺色彩转换、视觉正确或OS隔离。

## 冻结范围成员执行

ScopedExecutionFiles固定原root/范围/生命周期断言，真实Win32仅读句柄持全部祖先防替换，普通单链接文件最多1MiB，输入合计8MiB；目录枚举持实际目标及祖先句柄。Node只接受这些快照，预算来自冻结声明；输出仅在原Job全部退出后读取，不自动写回。开发Electron从项目依赖解析koffi，打包使用resources/koffi。平台失败仅在原资源确认收束后通知onSettled；未知保持任务占用。

## 原隔离执行核实与清理

IsolationLifecycle在创建profile前保存私有来源，在恢复挂起线程前保存真实进程创建时间；失败不执行脚本。Win32IsolatedNode使用当前登录会话唯一命名Job，重名拒绝且不终止已有Job。Win32IsolationRecovery核FILETIME/session，只有原宿主退出后才查询Job，避免提前持句柄影响KILL_ON_JOB_CLOSE。暂存目录核volume/fileId、owner随机值与真实临时父目录，扫描并持有全部原对象句柄后才删；链接/硬链接/替换/超限拒绝，最多4096对象和64层。清理不按PID终止、不创建profile或重跑程序。原运行异常收尾通过闭包重试同一资源；没有分配资源的前置失败释放等待标记。

桌面 NSIS 更新已独立到 [updater](../../updater/ARCHITECTURE.md)，本目录不承载检查、下载或安装逻辑。
