# 0.1.20 候选集成与安装验收

日期：2026-11-15。范围：Flow C 图标、品牌目录统一、design 运行资源拆分；用户授权完整 CI、隔离安装及通过后正常合并。未授权本步投放公开稳定通道。

## 冻结制品

- 构建提交：95b799de4cd8fc3e3e907d26b279fa6d1bb2ce01。
- 验证提交：c73d8a49d05907c832baa27884d32b9c254f8b21；只比构建提交增加验收措辞兼容、对应测试及开发记录，产品、品牌、依赖、内置日志和构建输入没有变化。
- 草稿 Release：445962642，desktop-v0.1.20；四附件已核对 digest/大小，不公开，不修改旧版本附件或 Python latest。
- 安装器：CBIM-Setup-0.1.20-x64.exe，110431281 字节，SHA-256 d16d865876090ed509b46a7e475202f56b0f785de0dcb12be83da9b590269dc0。
- Windows 未签名、发布者未验证；真实签名状态 NotSigned。资源公钥与 0.1.19 相同，SPKI SHA-256 c3ef7bbabd7b1a03eb5faf3f755d0dc728969585e573d5ce937411b4a314a31f。
- R1：64 个文件，不含 design/docs；四个 E 包均与已公开 runtime-engines 附件摘要一致。

## 完整 CI

[正式四片 CI 43702922295](https://github.com/nan023062/cbim/actions/runs/43702922295) 在 c73d8a49 对 master 基线 6ef19cffe50518f7977bb88ec4fa59812cf3f804 执行。四片和 Shared static checks、CBIM validation 均成功，覆盖汇总确认 530 个文件、3575 通过、0 失败、2 条件跳过，无重复/遗漏分片。

跳过项明确不计为通过：knowledge-source-lifecycle-application 的固定 pre-source EXE 用例、owner-execution-legacy 的固定 pre-owner EXE 用例，均缺对应历史 EXE 夹具。此次验收的是实际 0.1.19 来源，不冒充这些更早版本已验证。

## 隔离 Windows 安装

[通过的 run 43702918148](https://github.com/nan023062/cbim/actions/runs/43702918148)：mode=candidate，来源 0.1.19，目标 0.1.20，校验冻结提交与安装器摘要。预检 111 项通过。

- 全新安装、启动、退出、原安装器缓存摘要通过。
- 首次从公开源下载 Pi E，逐文件核验 15340 项，真实引擎完成 1 次确定性模型请求。
- 实际 0.1.19 安装后升级到候选通过，工作区、模型、已完成会话、localStorage、标记、知识、业务文件、引擎安装/缓存、主 Agent 与自动化均保留；无重放、无页面错误。
- 欢迎页新 SVG 正常加载并保存明暗截图；EXE 与 NSIS 安装器原生 32px 图标对源 ICO 的像素匹配率均 1.0，SVG/PNG/ICO 三份资源摘要一致。
- 候选覆盖安装不是公开在线发现/下载/差分升级；这些字段按脚本标记未执行。

## 失败与恢复

[首次 run 43702615263](https://github.com/nan023062/cbim/actions/runs/43702615263) 已通过品牌核验，随后因说明为“未做代码签名”而测试只识别“未签名”失败。保留失败报告，只修复同义披露识别；实际 NotSigned 检查保持。修复后 95 项输入测试通过，复用原候选，未覆盖草稿附件。

本机精确 EXE 还通过 isolated-node-smoke 的 files、network、timeout、cancel、nonzero、output-limit 六场景及自有资源回收；官网预览 14 场景通过。官网公开版本仍为 0.1.19。

## 交付边界

[PR #93](https://github.com/nan023062/cbim/pull/93) 保存实际 CI、制品与最终合并回执。本记录及开发日志的后续提交仅属文档，不进入候选 R，也不改变内置发行说明；仅运行相应文档检查，不把文档 head 冒充完整 CI 的源码 head。合并后候选仍保持草稿，公开发布另行执行。
