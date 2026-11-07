# Step38 原知识事务核实验证

2026-11-08，R03-D1，承接 `ae7d7b5`。约定范围已完成；R03 仍有治理、负责人及其它持久通道待适配，第 9 组只保留计划。

## 实际行为

主调用的“核实当前影响”支持 `cbim_knowledge_commit` 与 `cbim_object_commit`。原 canonical 身份、唯一原授权与知识范围核实后，按实际工具解析结果恢复原请求，或从固定私有缓存读取原对象计划。原 journal 的请求指纹、来源、治理与前后正文仍由唯一 KnowledgeStore 核验。

报告区分 absent、prepared、committing、committed、rolled_back、recovery_required 与 unverifiable。原工具 failed/unknown 保持；原事务 committed 只显示原版本、变更数量与摘要，不证明今天正文仍相同或业务已验收。查无记录不当作未执行，对象事务不证明后续空目录修剪。两次读取阶段变化使观察依据失效，不能保存为确定处置；查询不提交、刷新、恢复或修剪目录。

旧实例请求可在重开后只读查询，当前实例不替换原请求身份。公开 DTO 是纯 Schema，后端原请求/计划解析单独维护；旧报告和已保存处置不补字段或改变 basis。明确处置仍沿现有稳定请求、原回执与后续独立周期协议。

## 验证证据

| 验证 | 实际结果 |
| --- | --- |
| 首批 | 3 文件 20/20；另发现测试替身的泛型声明不满足 TypeScript，改为保留泛型的包装函数 |
| 相关回归 | 10 文件 89/89，包括既有知识工具、原影响处置与真实 Pi；`test-results/knowledge-effect-related.json` |
| 最终拆分后 | 7 文件 47/47，包含两类真实 Pi、原请求/计划/阶段、坏身份/指纹/返回、停止、读取竞争、旧报告兼容及 13 项依赖/分层检查；`knowledge-effect-split-final.json` |
| 类型与架构 | 产品类型检查、桌面脚本独立类型检查通过；51 目录、491 代码/样式，919 维护文件、4841 含类型依赖，0 环；3 处已审核外部动态加载 |
| 最终包 | `20261108-061532` EXE/ZIP 成功；构建前后 497 项源码/配置 SHA-256 一致：`73601f00a9f77e49e03cecdb93c0471143b896b7b5e62777164054bf9054da27` |

这些报告有重叠，不相加为独立用例总数。本步未重复全仓；Step37 的 289 文件、1915/1915 是上一提交的历史验证，不作为本步全仓结果。

最初构建因公开协议间接导入 `planned-commit.ts` 的 Node 哈希实现，渲染打包报 `createHash is not exported by __vite-browser-external`。已将实际原请求解析拆入后端 `knowledge-write-input.ts`，公开 `knowledge-write-observation.ts` 仅依赖 Zod；最终类型、定向、架构与构建均重新通过。失败构建回执保留为 `knowledge-effect-make-final-receipt.json`，成功回执为 `knowledge-effect-split-make-final-receipt.json`。初次边界命令的测试路径不存在、脚本检查未纳入 mjs 类型推断，均修正验证配置后通过，不计作产品测试通过项。

## 最终 Windows EXE

正常知识与对象计划各一场：隔离源码 Application 的真实 Pi 先完成一次提交，测试在提交后破坏工具输出；最终 EXE 重开该工作区，通过真实界面点击核实、保存明确处置和查询原命令。最终包没有注入测试入口。

- 两场模型请求分别 11、8 次，原实际提交各 1 次。最终包查询、保存处置及再次重开新增请求均为 0。
- 原工具保持 failed，原知识事务显示 committed；对象场额外显示目录修剪限制。原 journal、canonical/native 字节、原周期和运行保持。处置独立追加，重复查询与重开不追加旧写入或修改原事务。
- 普通聊天草稿保持；页面、通信、供应商错误全部为 0。两场自有桌面进程、供应商和临时目录均关闭/清理。
- 生成 6 张截图，已目检两场原事务展示及两场重开的 4 张关键图。报告为 `knowledge-effect-direct-ui-smoke.json`、`knowledge-effect-object-ui-smoke.json`，原 journal 和 canonical/native 字节归档在对应 `*-ui-original/`。

EXE：`build/20261108-061532/CBIM Assistant-win32-x64/CBIM.exe`。

ZIP：`build/20261108-061532/make/zip/win32/x64/CBIM-Assistant-20261108-061532-win32-x64-0.1.0.zip`。

EXE / app.asar / ZIP SHA-256 见 `test-results/knowledge-effect-final-artifacts.json`。中文文件头、重要接口、7 份 CONTRACT 与 11 份目录类图同步。本机确定性模型只验证实际协议与执行链，不代表在线自主判断质量。

## 后续

旧 `cbim_knowledge_refresh` 输入没有可绑定的原内部事务 ID，本片不按最近日志或相似正文补造原请求。下一片 R03-D2 适配治理观察/提案与负责人变更各自的原命令和账本；受控文件的统一观察关联、其它异常通道和 R04 其余依赖修订继续按支持矩阵推进，不能据本片宣布 R03 或第 1–8 组全部完成。
