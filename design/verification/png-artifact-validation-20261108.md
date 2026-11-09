# Step52 / R09-B：静态PNG真实解码验证

日期：2026-11-08。承接CSV本地提交a7ba217，按[本片计划](../task/png-artifact-validation.md)实现32×32 RGBA界面资源代表任务；[支持矩阵](../task/professional-validation-support.md)仍保留程序与外部专业输出的独立验收。

## 实际交付

png-raster-v1冻结精确宽高与RGB/RGBA采样通道。纯Schema位于core/workspace，实际解压和像素还原位于main/platform/png-validator；知识或前端不加载Node解码器。ArtifactFiles.validateImage对同一安全句柄读取的完整字节同时取文件指纹和专业判定，成员实际能力预检、原验证器身份及共同验收出口保持一致。

支持8位非交错静态RGB/RGBA，逐块CRC、完整IDAT压缩流及五种行过滤器；核签名、整数范围、块类型/保留位、顺序、唯一IHDR/IEND、连续IDAT与无尾随数据。仅另支持前置唯一sRGB/gAMA/pHYs，并核参数及sRGB/gAMA一致性。APNG、调色板、灰度、16位、交错及其它块明确拒绝，不忽略扩展后宣称整体通过。依据[W3C PNG规范](https://www.w3.org/TR/png-3/)定义此产品子集。

文件≤1 MiB、各维≤4096、像素≤1048576、块≤1024。Node24 inflateSync限制实际解压长度并核输入消耗，拒绝截断、多个/尾随压缩流、解压长度不符或无效行过滤器；随后真实还原全部像素再匹配条件。诊断不含像素或块正文，元数据不作视觉或色彩正确性证明。实现使用[Node有界解压接口](https://nodejs.org/download/release/v24.13.0/docs/api/zlib.html)。

PNG类型与参数共同参与原schemaHash；旧JSON/CSV保持兼容。验证调用、唯一wire、canonical、原基线或完整清单须一致；完整模式在解码两侧重核全集合。后续写入、外部图片变化或其它目录项变化不能沿用旧passed，负面人工意见仍能独立保存。

## 最终验证

- 源码与脚本类型检查均使用--noEmit；架构51目录535代码/样式一致；依赖1038文件5588条（含类型）、0环，3处已审核外部动态加载未增加。
- 相关36文件 **283/283**，0失败/跳过，约251秒；本片未重跑全仓。26项图片解析检查含独立手工像素样本逐字节对比、五种过滤器、RGBA透明像素、逐字节IDAT分块、元数据、坏CRC/压缩/顺序/尾随数据/超限及像素上限完整解码。实际平台安全读取、运行时原证明及旧JSON/CSV/Workflow/完整集合/删除移动回归同时通过。
- 真实Pi的JSON/CSV/PNG三类共15场，PNG包括完成、变化、停止、拒绝和补证；PNG运行时9场覆盖文件基线和完整清单、未知端口、停止/竞争、原验证器篡改与坏wire。仅模型回复来自本机确定性服务，不是在线自主模型质量验收。

见[检查回执](../../test-results/png-validation-final-checks-receipt.json)、[最终回归](../../test-results/png-validation-final-targeted.json)、[回归指纹](../../test-results/png-validation-final-targeted-receipt.json)、[打包回执](../../test-results/png-validation-final-make-receipt.json)。

最终EXE **20261108-151047** 四场桌面验收：

| 场景 | 主/成员请求 | 实际结果 |
| --- | --- | --- |
| 正常重新导出 | 6 / 16 | Pi经真实Node命令生成16像素PNG，真实解码后尺寸检查拒绝交付；再次实际生成32像素RGBA并重新读/采集/验证后完成 |
| 验证后图片变化 | 7 / 16 | 隔离文件的像素改动，主审阅拒绝旧文件证明，目标未完成 |
| 停止 | 3 / 9 | 错误图片后的修复暂停点停止；只生成一次，没有候选，周期cancelled |
| 人工拒绝 | 10 / 16 | 当前图片变化不能接受，明确保存拒绝并独立继续；目标仍未完成，没有自动返工 |

这里Node命令只负责生成测试产物；专业判定由真实PNG平台解码器产生，命令返回成功不是验证通过证据。没有将此生成命令称为OS隔离执行。四场均重新打开同一实包，原记录、文件时间、普通草稿和模型计数保持，未重放；页面与传输错误均0。21张截图生成，尺寸拒绝、修复通过、变化后未完成、人工预览和拒绝回执共5张已目检。

见[桌面总回执](../../test-results/png-validation-final-ui-receipt.json)、[正常](../../test-results/png-validation-complete-ui-smoke.json)、[变化](../../test-results/png-validation-changed-ui-smoke.json)、[停止](../../test-results/png-validation-stop-ui-smoke.json)、[人工](../../test-results/png-validation-human-negative-ui-smoke.json)、[文件摘要与截图清单](../../test-results/png-validation-artifacts.json)。原用户CBIM保持运行，本片测试只操作自有临时工程。

检查、回归、构建与桌面验收前后指纹一致：

- 源码/构建544文件：49f30271057dd3f7873f163e4248d44cc3edd810bfe99e60c2782bd9db5a7bdc
- 内置资产21文件：84fb0ed1395663aac19775275bdac83c1c1249e9e5582c4becc66258b79d1783
- 测试/脚本538文件：1fa3edbdaffb1bc88bea4b28742098fa38155054dae3b75015a0d92bbaca6f2d
- app.asar SHA-256：c31981945a893440eeedc5eb29411299d342af3550969f320f59b1fd2fb95b34
- ZIP SHA-256：e41798460a77cefd6f0a5d942547c1829e44713dd916bf79aa57e34672c6b243

## 维护与限制

同步13个源码文件（含2个新增）的中文文件头、关键接口与字段说明，以及9组CONTRACT/ARCHITECTURE：core/workspace、core/tasks、core/brain、core/brain/pi、core/policy、main、main/platform、scheduler-engine/execution、frontend/tasks；内置执行说明、roadmap与开发记录同步。新增依赖保持平台→纯协议方向，没有将zlib引入纯Schema或前端。

这是明确PNG子集的编码、像素可解码与冻结尺寸/通道检查，不是所有PNG扩展、视觉质量或真人业务验收；安全读取不是OS隔离或跨进程原子快照。R09仍部分完成，下一片先列R12执行隔离支持矩阵并验证平台能力，作为R09-C真实程序检查前置；外部专业输出/R07-C与R13衔接。R03及R09–R17继续，第9组只计划。本片独立本地提交、不推送。
