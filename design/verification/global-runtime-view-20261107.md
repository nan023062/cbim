# 全局运行总览与原会话定位验证（2026-11-07）

对应计划：[全局运行总览与真实任务定位](../task/global-runtime-view.md)。

## 最终产物与结论

- 最终 Windows 包：`build/20261107-150250/CBIM Assistant-win32-x64/CBIM.exe`，`stage=package`，完成时间 `2026-11-07T07:03:17.586Z`，打包退出码 0。
- 最终相关回归：9 个文件、58/58 项；边界 13/13 项；类型和架构检查通过。
- 架构：51 个目录、367 个源码/样式文件、637 个维护文件、2863 条包含类型引用的依赖、0 循环，同步 10 份 `ARCHITECTURE.md`。
- 全量回归 200 文件 **1158/1158**，退出码 0，耗时 602 秒，[原始结果](../../test-results/global-runtime-view-full.json)。该轮在最终行身份 key 补全前启动；最后修正另由上述 9 文件 58 项定向覆盖，不能描述为修正后重新全量。

最终 EXE 实际显示两个工作区、三个主会话的真实调度周期、人员实例、执行任务和准入等待。安全 waiting 与最近主模型轮次 completed 同时存在；总览将两者分别表达。读取页面、筛选、无变化轮询、导航和重开均未增加模型请求，没有自动恢复执行。

## 真实执行来源

新 [Application/Pi 测试](../../tests/global-runtime-view-pi.test.ts) 和 [fixture](../../tests/global-runtime-fixture.ts) 复用未修改的 `scopeWaitProvider` 与 `globalAdmissionProvider`。只有本机 SSE 响应内容是确定性的；实际 Pi 进程、成员派发、原生文件读取、证据、主审阅、准入和持久化均走产品链路。没有把构造的完整监管 snapshot 当作实际运行。

| 主会话 | 真实状态 | 主模型请求 | 成员模型请求 |
| --- | --- | --- | --- |
| A 工作区，会话一 | 成员实际读取文件，主审阅请求用户补充并安全 waiting；最近主 run 已 completed | 6 | 5 |
| A 工作区，会话二 | 主派发后结束，独立成员已取得资格并停在本机响应闸门 | 3 | 1 |
| B 工作区，会话一 | 主派发后结束；成员已受理但等待全局名额，尚未创建 run | 3 | 0 |

总计 12 次主请求、6 次成员请求。准入上限在两个已启动的主轮受理后，经真实设置 IPC 从 4 降为 1，不停止现有轮次；按受控顺序释放主轮，形成一个真实活动成员和一个未启动成员票据。

真实 Application 测试通过：精确 workspace/root/task 归属、三个独立主实例、waiting 与 completed 模型轮次的区别、真实缺失/部分用量、连续 noop、顺序停止、重开不重放。另对实际 snapshot 做 JSON 传输往返后严格 Schema 校验，对 noop 做 `runtimeReadSchema` 校验。[测试 JSON](../../test-results/global-runtime-view-pi.json)。scope-only 事务、组合事务只递增一次、退役 epoch 和缺省历史等细粒度边界由领域测试覆盖。

## 最终 EXE 点击与增量观察

执行：[global-runtime-ui-smoke.mts](../../scripts/global-runtime-ui-smoke.mts)。

```text
pnpm exec tsx scripts/global-runtime-ui-smoke.mts
```

最终退出码 0，[真实桌面回执](../../test-results/global-runtime-ui-smoke.json)绑定构建 `20261107-150250`。页面错误、意外对话框、供应商/HTTP 错误全部为 0。

- 从实际输入框为三个会话选择模型、发送目标并保留三份不同草稿；侧栏点击“运行管理”，没有直接注入页面快照。
- 真实工作区和状态筛选正确收窄列表。统计保持全局口径，安全 waiting 不误标目标完成。
- 测试只在 Electron IPC 边界计数原调用和原回复，未改变其行为或内容。最终记录 5 次 noop；其中连续两次验证同一行 DOM 对象、零子树变更、同一运行游标，没有页面阅读引发的新模型请求。
- 从 B 的真实任务行点击“打开任务节点”，定位原工作区、原根会话、原周期和已选节点，即使 B 尚无成员 run；从 waiting 周期和 A 活动任务行回到各自原会话，三份草稿保持。
- 离开总览后，等待在途回调收束，再跨过一个完整轮询周期观察 1.6 秒，`runtime.read` 调用数不再增长。此结论仅针对监管读取，不声称会话页其他正常读取全部停止。
- 从原会话顺序停止未启动的 B、活动的 A、持久 waiting，随后重开 EXE。三个周期都显示取消、活动运行和准入占用为零，原日志字节保持，模型请求数未增加，三份草稿仍可找到。

本次用量观察为登记 6 轮、已报告 5 轮、未报告 1 轮，`costPartial=true`。本机确定性模型已报告部分为 0 Token / 0 估算费用；界面明确显示“用量缺失 1 轮”和“已知部分”，没有将尚无报告的活动轮次补成完整零费用。这里不验证在线 Token 消耗、计费或上下文容量估计。

### 关键截图与真实标识

- [运行总览](../../test-results/global-runtime-overview.png)：1 个活动运行、3 个周期、安全等待及部分计量说明。
- [B 未启动任务准确定位](../../test-results/global-runtime-task-navigation.png)：原主会话图、原目标模块、准入等待和所选成员节点。
- [返回安全等待会话](../../test-results/global-runtime-waiting-navigation.png)：最近主模型轮次结束，目标仍等待补充，草稿保留。
- [明确停止后的状态](../../test-results/global-runtime-closed.png)、[完整重开后的总览](../../test-results/global-runtime-restored.png)。

上述最终截图已实际查看，文本和状态可读。完整身份在 JSON 回执保存；本次 waiting 根为 `dc286d14-1276-4dd3-8dba-db701125695e`，A 活动根为 `e499ebc0-e281-4f08-80d8-9f4a29e3e48b`，B 准入等待根为 `13bc56d5-35b2-4880-b245-0cbbade472ed`。

## 中间发现与证据保留

1. 早期 Application 联调启动时，Core 类型已增加 `scopes`，manager 返回尚未落盘，因此断言缺字段失败；等待实现完成后，真实链及最终严格传输测试通过，没有降低断言。
2. 旧包 `145809` 首次桌面测试在 noop 追踪断言失败：测试误把 Electron IPC `{ok,value}` 外层当业务结果读取。实际 DOM/游标稳定断言已通过。改为读取原回复 `value.mode` 后同包通过；没有改产品或伪造 noop。[首个失败证据目录](../../test-results/global-runtime-initial-trace/)。
3. 独立代码复核发现全局行身份 key 未含完整 root/task，可能混淆同工作区不同根下同号任务。产品补全身份并加入回归、重新打包。`145809` 在途成功结果只保留为中间事实，不代替最终包验收。[中间证据目录](../../test-results/global-runtime-intermediate-145809/)。
4. 最终 `150250` 使用全部原桌面流程重新验证并通过。没有再调用旧构建。

## 限制与资源清理

- 本片是只读观察和精确导航；总览不发起重试、恢复、改派或派工。状态和已报告消耗不是业务验收或全局预算许可。
- 同号任务跨 root、迟到/退役回调、纯 scope-only 提交等由定向测试验证；真实桌面使用真实生成的不同任务标识，不声称刻意制造了全部碰撞组合。
- 所有项目、模型配置和文件均属于本次隔离 fixture，没有操作真实用户账号或业务目录。
- 最终及中间成功窗口都正常关闭；复核两个相关构建的测试 `CBIM.exe` 进程为 0，成功运行的临时目录已清理。首次追踪失败目录 `cbim-global-runtime-ui-LskcnN` 暂留作证据，未尝试删除此前被审批拒绝的其他临时目录。
