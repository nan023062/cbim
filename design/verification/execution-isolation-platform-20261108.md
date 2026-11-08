# Step53 / R12-A：Windows 隔离执行平台验收

日期：2026-11-08。承接本地提交7b7fae5。本片完成可信平台端口；任务级授权、模型工具替换和程序业务验证仍待后续。R12不标为整包完成。

## 实际交付

- 将宿主可信Node/Electron执行器及必需数据复制到本次私有runtime；最多64份、总8 MiB快照进入只读input，output独立可写。原业务工程没有ACL扩权或自动写回。
- Windows x64真实LPAC：唯一AppContainer profile，固定registryRead，网络capability为零。挂起进程创建时直接绑定不可breakaway的Job，线程运行前核原Package SID、唯一能力及Job成员。只有明确NUL输入和输出管道可继承。
- Job限制进程数、提交内存及累计用户态CPU；宿主按单调时钟限时及取消。主程序结束仍有后代立即收束；确认主进程与Job全部结束后才返回输出。宿主强制退出由Job关闭收束后代，原owner记录不会导致自动重放。
- 64 KiB管道输出、32项声明输出、每项1 MiB／总4 MiB；输出按同一普通文件句柄核身份。状态、退出码、实际字节哈希及内核计量分别记录；非零退出不作为成功。清理持续失败拒绝交付且保留owner，短暂映像占用仅重试清理。

## 最终验证

- pnpm typecheck、pnpm check:architecture、脚本tsc --noEmit通过：51目录538源码/样式，1046维护文件5597依赖（含类型），0环；4处第三方动态加载已逐项审核。
- 最终相关12文件130/130，0失败/跳过，87秒。包含22项隔离／宿主崩溃测试、6场现有真实Electron utility/Pi，以及文件验证与架构回归。本片未重跑全仓，不累加重叠批次。
- 文件正反例、输入改写、外部目录联接、ALL_APPLICATION_PACKAGES哨兵、额外可继承句柄、环境变量、回环/局域/互联网连接、进程与内存正反预算、输出超限、超时/取消/宿主崩溃及清理失败均有实际或注明的故障注入证据。网络负例要求EACCES/EPERM，不接受超时作隔离证明；本机未隔离连接先成功。
- 最终EXE 20261108-155211用自身Node模式载入打包平台模块，六场files/network/timeout/cancel/nonzero/output-limit通过；观察到后代实际存活后才停止，并核其结束。另复制完整包到仓库外，在PATH无Node/Python条件下启动真实桌面、内部知识和CRUD通过，原宿主规则保持；不是干净机器或在线模型验收。
- 本片无前端变更，没有新增截图或宣称页面错误计数；平台验收与真实桌面便携启动分别记录。最终成功场景的自有运行目录/profile已清理；原用户CBIM进程未操作。

## 原失败及修正

- 原生探索首轮错误读取UTF-16指针导致探针异常退出；其唯一临时profile与目录已核实清理。缺Windows启动环境返回203；零能力LPAC下Node的WSAStartup返回10107，因此固定且明确声明registryRead，不静默降级普通AppContainer。Electron还需其实际V8 snapshot数据。
- 初始进程额度夹具误以为拒绝派生后主程序必为0；实际Node可能抛UNKNOWN或等待。改用同一脚本额度2确实派生、额度1确实拒绝，保留真实非零退出。内核峰值可能含失败提交，不把它误当成功分配；用512/128 MiB同脚本正反例验证实际分配被阻断。
- 首轮冻结相关127/128：一项结束后清理映像报EBUSY；修正为同目录有界清理重试及owner最后删除。20261108-154323初包在固定短延时停止场未稳定取得后代PID；改为观察实际ready及存活后停止。旧失败报告和现场保留，不能写成初包全部通过。

## 指纹与产物

- 源码/构建配置548项：e0f203f4835ada63cf18c4dafc158d0bc18b072319539764972cd12d81d3d754
- 内置资料21项：84fb0ed1395663aac19775275bdac83c1c1249e9e5582c4becc66258b79d1783
- 测试/脚本542项：b54d8d1e2f6cc48d949e68eaa1abb89b7575240d4c977551d9eaddca30156853
- 最终检查、相关回归、构建和两种EXE验收前后均为上述同一指纹。
- CBIM.exe：213976576 bytes，SHA-256 6d19fb9acb68fe361ad11fa92b7d765d7c2398888b7aa1aa227e68f796471497
- app.asar：3278377 bytes，SHA-256 20d706517ba65b2a42a102075755e9616494f86752f609a3b06fcb08a67c8e69
- CBIM-Assistant-20261108-155211-win32-x64-0.1.0.zip：180420844 bytes，SHA-256 9e99f98bc81735d8160b7124e8f8c44f3e481906d262d53f4b314ed7c491ec8e

证据：test-results/isolation-fixed-checks-final-receipt.json、isolation-fixed-targeted.json、isolation-fixed-make-receipt.json、isolation-fixed-packaged.json、isolation-fixed-smoke-receipt.json、isolation-fixed-portable.json、isolation-fixed-portable-receipt.json、isolation-artifacts.json。初轮及探索证据另保留。

## 边界及接续

本片只支持明确Windows x64平台端口。registryRead与Windows授予LPAC的系统资源仍可访问，不声称任意OS对象完全不可见；输出空间没有磁盘硬配额，期限需宿主事件循环正常调度，CPU/进程/提交内存由Job约束。暂未给模型原生read/write/edit/bash增加隔离，也没有任务级细粒度范围、未知执行持久核实或自动孤儿清理。下一片R12-B把这些边界接入冻结任务与可信授权，再接R09-C程序验证。

中文文件头、关键接口及字段已维护于三个isolated-node源码；platform/CONTRACT.md、platform/ARCHITECTURE.md和main/ARCHITECTURE.md同步。Core/Bridge/Frontend不导入Win32，第三方koffi的私有固定加载已审核。见[支持矩阵](../task/execution-isolation-support.md)与[剩余交付](../task/remaining-deliveries.md)。本地独立提交，不推送；第1–8组继续，第9组仅计划。
