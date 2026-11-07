# 异常恢复支持矩阵

2026-11-08，按 Step35–41 的实际代码归纳。Step41 刷新已通过真实Pi及最终EXE，见[验证](../verification/refresh-effect-verification-20261108.md)。本表定义覆盖与缺口，不把通用异常恢复标为全部完成；实时状态见 [roadmap](../tool-architecture-roadmap.md)。

| 原通道 | 可核实的事实和处理 | 仍未覆盖的事实 |
| --- | --- | --- |
| 主 goal plan/review、dispatch task/cancel/add/replace/resume/abandon | 原 canonical、唯一周期、实际请求与八类已保存命令；显式处置及符合资格的新只读核实/新业务修复 | 保存控制面不表示业务已执行或验收 |
| 原生 read/write/edit 的明确单文件 | 原授权路径的当前存在性、字节数/哈希、已有显式基线 | 当前值不能证明原操作完整效果；旧调用没有 before 正文，不补造补偿 |
| cbim_file_write_controlled | 原 prepared/executing/applied/not_applied/unknown、完整成员绑定、独立补偿历史；满足原预览资格才能另建显式补偿 | Windows NTFS 现有 UTF-8 单链接普通文件、正文各≤1MiB；不覆盖创建/删除/重命名、元数据或外部命令 |
| knowledge_commit、object_commit | 精确原请求或私有原计划的已校验 journal，失败回包和 committed 分开 | 对象后置空目录清理仅保留警告；缺计划不按当前正文恢复来源 |
| knowledge_refresh v2 | 原授权契约版本、revision/requestId 的空 changes 事务；原 journal、观察及处置 | v1 随机内部 ID 无法关联，保持 unsupported；不将查无等同未执行 |
| governance observe/propose、module_owner_change_commit | 原治理保存记录、原责任不可变事件及命令回执；原实例来源和完整指纹 | 观察不批准/实施提案、不换负责人或交接；今日关系头不替代原命令 |
| 成员 task plan/step/inspect/delivery、产物采集、JSON validation、help/checkpoint | 原 canonical 执行报告、原绑定与进度/证明；检查点只按现有同周期一次协议，交接另行显式放弃 | 没有原日志不重建事实；跨重启续执行由 R05 扩展；完整产物由 R07 扩展 |
| knowledge_preview/move_preview、object_preview | 原回包/计划可读；仅正式 commit 会写知识。丢失私有 planId 不自动提交，可在明确新意图下重新预览 | 私有预览缓存没有通用原调用持久核实；新预览不是原未知提交的重试证明 |
| rules_validate、task_cancel | 有本实例维护 taskId 时通过 task_status 查询实际 running/completed/failed/cancelled；取消请求与终态分开 | 运行内任务表非持久日志，ID丢失或重启后不证明原结果；不得盲目再启动维护任务 |
| 仓库 list/get、一般只读查询、ask_user | 原回执和当前明确重新读取；真实仓库身份/撤销仍核验，问题答复不签署人工验收 | 重新读取不是原版本；当前连接器仅静态资料读取，外部写协议见 R13 |
| bash、任意外部动作及损坏/缺失来源 | 保留 unknown/unsupported，明确记录处置并按资格新建只读核实；不自动执行探测或逆向命令 | 无普适完整副作用证明或自动补偿；外部幂等/取消/真实服务与 R13 联合验收 |
| 桌面岗位/治理/资源导入等显式命令 | 沿既有本机原 commandId/planId、原记录查询与实例/版本门禁；不伪装成主/成员工具来源 | 尚无统一跨所有桌面动作的影响观察来源；具体领域恢复规则不被本表替代 |

所有查询均保留原工具失败、未知及原人工决定。明确处置只是本机附录，后续核实/修复需原身份、唯一已关闭周期、无活动成员、完整来源和新权限；不直接继续未知 native。

R03 已交付本地可证明的原命令/副作用观察、明确处置与新周期关联、受控补偿；仍保留外部写通道、跨领域桌面来源与上述无持久身份分支的明确限制。R05/R07/R13 推进时必须回填本矩阵对应验收，不能把这些要求移至第9组或以局部支持宣称整包结束。任意 shell 的普适逆向不作为可实现保证。
