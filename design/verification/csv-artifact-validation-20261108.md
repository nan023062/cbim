# Step51 / R09-A：真实 CSV 产物验证记录

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-08。承接 Step50 本地提交 26ac724；本片按[计划](../task/csv-artifact-validation.md)完成库存 CSV 代表任务，[R09 支持矩阵](../task/professional-validation-support.md)继续保留 PNG、程序及外部专业输出的独立验收。

## 已完成行为

- 新增 csv-table-v1 冻结声明与有界纯解释器：精确表头/顺序、列数、字符串/整数/数值约束、行数和原字段组合唯一键。解析真实 UTF-8、逗号、双引号及双写转义、CRLF/LF、引号内换行与可选 BOM；坏编码、引号、裸 CR、NUL、错误字段及重复键不能通过。
- 限制单文件1 MiB、10000条数据行、32列、字段4096码点、声明32 KiB；超预算不截断作证。没有隐式类型修复、trim、默认值或公式执行；诊断最多16条且无单元格值。
- ArtifactFiles 从同一安全句柄读取的字节产生哈希与 CSV 判定；实际成员工厂公布并装配 validateTable。缺端口在模型启动前拒绝。CSV 类型与规则共同哈希，JSON 原算法与记录保持兼容；原事件、唯一 wire、可信回执及出口均匹配验证器。
- 基线或完整清单身份贯通验证、交付、成员结算、目标和人工决定。完整模式在检查两侧重核全集合；CSV 未变但目录新增也不能交付。检查后文件变化不能沿用旧 passed，真实负面人工意见仍可保存并显式继续。
- 页面分别显示 CSV 检查、字段位置和唯一键问题；修复后保留原 rejected，后续操作导致的历史失效单独表达。没有自动接受或重试入口。

## 最终冻结验证

类型检查、脚本类型检查均使用 --noEmit；架构检查51目录533代码/样式文件一致；依赖扫描1031文件5552依赖（含类型）、0环，保留3处已审核外部动态加载。相关33文件 **239/239**，0失败/跳过，约228秒。本片未重跑全仓，不能把此前全仓结果算作本片结果。

实际命令与每项退出码见[检查回执](../../test-results/csv-validation-final-checks-receipt.json)、[定向回归](../../test-results/csv-validation-final-targeted.json)、[回归指纹](../../test-results/csv-validation-final-targeted-receipt.json)、[打包回执](../../test-results/csv-validation-final-make-receipt.json)。涵盖解析/真实文件端口、停止/竞争、坏回包及类型篡改、完整集合、旧 JSON、Workflow 知识与选择、成员协议和真实 Pi。

最终 EXE **20261108-145110**，四条真实桌面/Pi/本机文件流程如下。模型回复来自本机确定性服务，不是在线模型自主质量验证。

| 场景 | 主/成员模型请求 | 实际结果 |
| --- | --- | --- |
| 正常修复 | 6 / 16 | Pi 写出错误库存表，真实字段/唯一键检查拒绝交付；第二次实际写入修复，重新读/采集/验证后完成 |
| 通过后变化 | 7 / 16 | 外部改动隔离测试文件，主审阅拒绝旧证明，目标保持未完成 |
| 停止 | 3 / 9 | 拒绝后的修复暂停点停止，只有一次实际写入，没有候选；周期 cancelled |
| 人工拒绝 | 10 / 16 | 文件变化关闭接受，显式保存拒绝及独立继续；不替代返工，目标未完成 |

四场重启均保留原记录、任务/运行身份、普通草稿和文件时间，无重复模型请求或文件写入；页面与传输错误均0。21张截图生成，已目检错误字段/唯一键、修复通过、变化后未完成、人工变化预览和拒绝回执共5张。原用户 CBIM PID71020保持运行，未操作其工程。

见[完整桌面回执](../../test-results/csv-validation-final-ui-receipt.json)、[正常](../../test-results/csv-validation-complete-ui-smoke.json)、[变化](../../test-results/csv-validation-changed-ui-smoke.json)、[停止](../../test-results/csv-validation-stop-ui-smoke.json)、[人工](../../test-results/csv-validation-human-negative-ui-smoke.json)、[指纹/文件摘要/截图清单](../../test-results/csv-validation-artifacts.json)。

检查、回归、构建与全部桌面验收前后指纹完全一致：

- 源码/构建输入542文件：e588a261aa0cb3c5c39e9aa1337ae6fd5092570fb8b619c5d79f060b7c7355a3
- 内置运行资产21文件：0ef0221e3bb30b5b14a890592e934a44134062fb9613580680c2ca906bcd1bb0
- 测试/脚本533文件：c5342d6ed23cc8acec049b3d5092225ba88a5fee265bd681925f36171b09c97d
- app.asar SHA-256：5cec7fb581088a32266f27fb7d4ecc397d7ee84b06025ffa9a9aff3688b927c3
- 分发 ZIP SHA-256：adfc6978e1530ee394d6b3946e70981ecbb13faee1661e23467fe1777546d72d

## 修正与维护范围

初轮新测试28/30：CSV完整清单夹具遗漏工具contractVersion，canonical核验正确拒绝；补齐真实契约并加强summary状态/端口调用次数断言，防止中途异常造成假通过。随后4文件30/30通过；初次脚本类型检查指出故障注入中的字面量被推宽，补充明确类型后最终检查通过。原失败报告保留，不算最终通过；最终打包四场未出现失败。

同步19个源码文件（含新增CSV解释器）的文件头、关键接口/字段说明，及9组CONTRACT/ARCHITECTURE：core/workspace、core/tasks、core/brain、core/brain/pi、core/policy、main、main/platform、scheduler-engine/execution、frontend/tasks。新增依赖只从纯声明/证明向基础层、平台向纯解释器；前端继续通过bridge读取公开协议。内置business-execution说明已同步CSV与互斥基线/完整清单选择。

## 限制与接续

表格条件不证明外部库存事实或业务语义，不支持任意CSV方言、数据库一致性或公式执行；安全读取不等于OS隔离或跨进程原子快照。R09仍部分完成，下一片为PNG静态图片，程序检查与R12、外部专业输出与R13分别验收。R03、R07-C及R09–R17剩余项继续；第9组仅计划。本片本地提交，不推送。
