# 0.1.21 发布验证（2026-11-15，未放行）

## 当前结论
PR #96 已建立并转为草稿，未合并、未公开发布桌面 0.1.21。新旧 Agent 执行路径的业务验证集成覆盖尚未完成迁移，不能用安装成功代替全量回归通过，也不能恢复旧 Team 入口或跳过断言来放行。

## 冻结候选
- 源码：6541c41da6b11d6b0c003cb4c3a13e631735a863。
- 构建：unsigned-20261115-211159-84059f60。
- Windows 未签名，发布者未验证；资源沿用现有 Ed25519 身份。
- 安装包：CBIM-Setup-0.1.21-x64.exe，110410965 bytes。
- SHA-256：25375bd045efb19dbea7cb72b2701afc01b23f8d18f1fba1142702709486837f。
- 草稿 Release ID：446073270，四附件已核对远端摘要。
- 先前两个本地候选不放行：第一次遗漏附加模型角色配置；第二次引擎适配器改动却复用已发布 1.1.0 身份。最终候选四个适配包为 1.1.1。
- 9a323352 只修改验收脚本和开发文档；旧安装缓存按升级前真实摘要核对，没有修改产品或构建输入。

## 已通过
- 类型、架构、测试模块归属、品牌及官网构建检查。
- 引擎打包与版本管理专项 8 项；对话、预算及递归相关专项见开发记录。
- `pnpm verify:desktop build/desktop-release/0.1.21/unsigned-20261115-211159-84059f60 --unsigned`。
- `pnpm exec tsx scripts/isolated-node-smoke.mts`：明确指向本候选 EXE，文件、网络、超时、取消、非零退出、输出限额六场景通过。
- 验收预检 108 项通过；首次进程集成因隔离工作目录未安装 Electron 二进制而未启动。执行 `node node_modules/electron/install.js` 后，单独重跑 `tests/desktop-acceptance-process-integration.test.mjs`，3 项通过。
- [隔离 Windows 安装验收](https://github.com/nan023062/cbim/actions/runs/43718250827)：全新安装、公开源下载 Pi 1.1.1、真实适配器处理确定性模型响应、0.1.19 覆盖升级，用户数据、旧引擎文件和停用状态保留，任务不重放；pageErrors=[]。这是候选安装，不是公开在线升级。
- 图标：EXE 与安装器原生 32px 图标像素匹配率均为 1，窗口图片载入正常，亮/暗截图已保存于 Actions 附件。
- 四个 E 1.1.1 不可变 ZIP 已追加到 runtime-engines prerelease，匿名下载大小与摘要全部核对。未切换签名索引，旧索引保持不变，未发布 runtime-c0.1.21。

## 未通过与范围
[完整四片 CI](https://github.com/nan023062/cbim/actions/runs/43717736089) 的静态检查通过。核对被后续提交取代的前一轮日志，发现 application-collaboration、json-validation、controlled-file、workflow-condition、scope-wait、goal-review、inspection-cycle、effect-observation、waiting-mixed-sources 等集成套件失败。当前源码最小复现确认后取消余下全量运行，保留失败事实，不能计为全量通过。

当前源码复现命令：
```powershell
pnpm exec vitest run tests/execution-collaboration.test.ts tests/unified-tool-policy.test.ts tests/json-validation-pi.test.ts -t 'validates actual|principal|permission|collaboration|主|成员|目标' --reporter=default --reporter=json --outputFile=build/release-blocker-021.json
```
实际选中 15 项：9 失败、6 通过，另 24 项因选择器未选中。9 个 JSON/CSV/PNG 场景均报告“真实冻结要求必须装配验证工具”。

原因边界：新 `loop.chat` 默认进入 `agent-tools-v1`，旧业务集成夹具仍要求主流程提供原派发/冻结验证工具；当前适配并未证明这些业务约束已通过新 Agent 工具链完成。不能直接把失败视为无效测试、删掉旧集成覆盖，或给普通新对话重新启用旧频道/派发状态机。后续须在 #94 核实旧格式只读/可信续接与新业务工具承载的边界，再迁移实际消费者和集成验证。

## 未执行
合并、公开桌面发布、R 通道投放、E 索引切换、公开在线升级和官网版本切换均未执行。Python latest 仍为 v1.0.2；桌面公开稳定版仍为 0.1.19。不能将本记录理解为发布成功。

## 后续专项迁移：九项文件验证（2026-11-15）

基线 17f032c7 后已把 JSON/CSV/PNG × 正常交付/文件变化/停止 的九项失败用例迁到真实 cbim_agent_call 调用链，保留 canonical、当前字节与重启不重放检查；新增调用方 cbim_agent_result_check。相关调用/运行循环测试 37 项以及类型、测试边界、架构检查通过。具体命令和范围见 development-log.md 的 #94 业务验证迁移记录。

这仅解除已定位的九项专项回归阻塞，不表示其余旧业务消费者、同文件六项人工目标决策或完整 CI 已通过。PR #96 保持草稿，原候选 6541c41d 过时，安装及发布记录仍只证明原候选。
