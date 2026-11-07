# 受控文件阶段与补偿的统一核实

Step40 / R03-D3，2026-11-08 约定范围已完成；[实际验证](../verification/controlled-effect-verification-20261108.md)。承接 Step39（a3b9f37）。将已有受控文件报告接入原成员影响观察、明确处置与独立后续周期，不另建文件写入或补偿机制。

## 支持矩阵与用户结果

| 原操作 | 核实事实 | 边界 |
| --- | --- | --- |
| cbim_file_write_controlled | 原 canonical 授权、完整成员/周期绑定、原输入与附录；prepared/executing/applied/not_applied/unknown 分别保留 | applied 不等于工具成功或业务验收；查无不能推断没写入 |
| 原操作的独立本机补偿 | 原补偿命令、阶段与序号 | 补偿不改原工具结果或原 applied/unknown；当前文件与补偿资格仍在已有预览入口另行核实 |
| 原记录缺失、授权不符、读期间变化 | unsupported / absent / unverifiable / changed_during_read | 不补备份，不启动进程、不读写业务文件，不回放旧操作 |

## 实施与验收

1. 复用纯受控 ledger 契约，无新旧字段默认化；报告时钟不进入稳定观察依据。原前后正文、备份路径、平台身份不公开。
2. Scheduler 仅接受可信原成员来源，主调用不冒充成员；校验原完整运行绑定、scope、call、稳定 operationId、路径及原 before/after 内容摘要，两次查询比较原阶段和补偿序列。
3. Main 复用已装配 ControlledFiles.report，只读原 Store/canonical，无子进程或文件租约；停止后不继续读取或提交处置。
4. 原 applied 后工具坏回包、真实部分写 unknown、未发写 not_applied 均可保存明确处置；有补偿的观察保留原操作，旧依据过期；错身份/输入/端口、缺记录与旧报告回归有测试。
5. 真实 Electron utility/Pi 与最终 EXE 核实、处置、重开验证原字节与模型/写入次数不增加；中文注释、CONTRACT、目录类图、roadmap 和实际记录同步后独立本地提交，不推送。旧 refresh 和其它异常通道继续按 R03 支持矩阵推进，第9组仅计划。
