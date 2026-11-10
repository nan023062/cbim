# Agent 的 Session 执行历史

团队中的静态 Agent 可以查看自己的独立 Session 履历。主 Agent 与自定义角色使用同一套只读历史入口。已退役的默认执行 Agent 只保留历史记录，不再作为新的执行入口；归档按当前工作区中的静态角色聚合，不合并模型上下文，也不重新启动已结束的任务。

## 从团队节点查看

1. 打开工作区右侧扩展区的「团队架构」。
2. 选择主 Agent 或一个自定义 Agent 节点，点击「执行历史」。Team 根和分组不是执行角色，没有此节点操作。
3. 在「Session 记录」中选择会话，再在「运行轮次」中选择一次运行。
4. 查看本次输入、公开回复、工具名称与状态、计划、证据引用和交付候选。身份详情包含记录时角色、实例、运行通道、所属主会话及配置版本；未记录的字段显示未知，不用当前定义代替。

角色定义已经删除时，从团队页顶部的「历史角色」进入，按名称或 ID 找到归档角色。该角色不会被重新加入静态团队树。没有实际运行记录的角色显示空历史，不会因打开页面而创建 Session。

「本轮结束」只表示运行完成；交付候选仍未经过业务验收。历史页面没有发送、恢复、审批、停止或确认收件按钮。处理正在运行的任务，应回到所属主会话和任务节点；直接从团队节点主动发起成员聊天尚未接通。

## 刷新与分页

历史页面按需读取，**不做实时轮询**。打开角色、Session 或轮次时读取相应记录；状态标明截至本次读取。需要查看新记录时使用「刷新角色索引」「刷新 Session」「刷新轮次」或「刷新本轮记录」，各按钮只刷新对应层级。

Session 与轮次列表每页 30 条，有更多时显示加载按钮。轮次详情每次读取 200 条公开事件，自动补齐已有分页后停止；单次操作最多补 100 页，仍有记录时显示「继续加载记录」。再次刷新从已确认事件游标增量读取，不重复追加已有事件。切换角色或 Session 后丢弃旧请求的迟到响应，避免混入其他会话。

主对话和任务节点中的实时成员视图仍使用各自的增量订阅机制；它们与本页的手动历史查询是不同入口。

## 角色、实例与 Session 的关系

| 对象 | 历史如何归属 |
| --- | --- |
| 主 Agent `cbim:main` | 静态角色只有一个，多个主会话各有独立主实例与 conversation 通道；续聊和成员结果回注形成该通道中的新轮次 |
| 历史默认执行 Agent `cbim:executor` | 已退役。旧独立实例记录仍可按原角色查询；新任务不再创建该角色 |
| 自定义执行 Agent | 按真实 Agent ID 聚合，可查看跨主会话的多个独立执行通道；同名不作为合并依据 |
| 已释放实例或已删除角色 | 历史仍保留；释放表示运行对象不可继续执行，不表示删除 Session、图或证据 |

新记录以真实 `agentSessionId` 作为历史 `sessionId`，同时保留 `agentInstanceId`、`rootSessionId`、`taskId` 和 `runId`。同一路径删除后重新创建角色，也不改写旧运行记录的名称和配置版本。归档是检索关系，不把多个 Session 拼接为一个 LLM 原生上下文。

## 本机存储与旧记录

应用用户数据根默认是 `<用户主目录>/.cbim`，设置 `CBIM_USER_DATA_ROOT` 时采用指定目录。以下路径均相对于应用用户数据根，与业务项目中的 `.cbim/` 知识目录不同：

```text
<workspaceId>/agent-history/<角色ID哈希>/sessions/<SessionID哈希>/<任务与运行ID哈希>.json
<workspaceId>/loop-engine/tasks/<taskId>/<runId>/events.jsonl
<workspaceId>/dispatch/runs/tasks/<taskId>/<runId>/events.jsonl
<workspaceId>/dispatch/dispatch.jsonl
```

第一项是可恢复的角色—Session—轮次摘要索引；后面分别是主对话、成员运行和派发事务的原始事实记录。历史功能不搬移或复制原生会话正文，不改变原日志归属。打开工作区时利用已有恢复扫描回补索引，后续接收已落盘事件；列表查询不重新扫描全部日志。详情只读取所选轮次，并核验其完整归属。

这些运行记录不写入项目 `.cbim/`，也不随人才市场中的 Team、Agent 或 Skill 静态资源包导出。删除静态角色不会删除运行档案；本功能没有历史删除或保留期限设置。

旧日志存在明确 `agentId`、但缺少实例和通道绑定时，显示「旧记录分组 · 未绑定通道」，分组键为 `legacy:<taskId>`。这只是历史检索键，不是补造的模型 Session。服务不从角色名称、原生文件路径或最新实例推测动态身份；连静态角色都未记录的日志不会被猜测归类，而是保留原文件并显示诊断。

索引或日志损坏时，页面提示「部分历史需要核实」。能验证的记录继续可查，不能验证的详情拒绝显示；空列表不表示损坏数据已不存在。重新打开工作区可以再次尝试从真实日志回补，不会因此自动执行模型、消费旧信封或重放工具。

## 只读 IPC 示例

以下调用用于可信桌面集成，工作区须已打开。标识从真实返回值选择；不要用页面位置、角色名称或原生文件路径替代身份。

```js
const call = (action, args) => window.cbim.call(action, args);
const workspaceId = '从工作区列表选择真实 ID';

// 1. 已有执行记录的静态角色；同时检查 diagnostics。
const roles = await call('agentHistory.roles', {workspaceId});
const role = roles.roles.find(item => item.agentId === 'cbim:main');
if (!role) throw new Error('该角色尚无可读取的执行记录');
const identity = {workspaceId, agentId: role.agentId};

// 2. 角色下的独立 Session。下一页原样传回 nextCursor。
const sessions = await call('agentHistory.sessions', {...identity, limit: 30});
const session = sessions.items[0];
if (!session) throw new Error('该角色尚无可读取的 Session');
const sessionIdentity = {...identity, sessionId: session.sessionId};

// 3. Session 中的运行轮次。列表游标不能跨角色或 Session 复用。
const runs = await call('agentHistory.runs', {...sessionIdentity, limit: 30});
const run = runs.items[0];
if (!run) throw new Error('此 Session 尚无可读取的轮次');

// 4. 单轮公开事件；后续传回本响应 cursor，hasMore 时继续取下一页。
const events = await call('agentHistory.events', {
  ...sessionIdentity, taskId: run.taskId, runId: run.runId, limit: 200,
});
```

`roles` 返回 `{roles, diagnostics}`；Session 与轮次列表返回 `{items, nextCursor?, diagnostics}`，`limit` 为 1～100、缺省 30。轮次事件返回 `reset / delta / noop`，含 `run` 和 `{runId, seq}` 游标；非 noop 带 `events` 与 `hasMore`，`limit` 为 1～500、缺省 200。首次读取及游标超前返回 reset，消费者应替换旧投影；noop 没有新事件。游标不能用于另一轮运行。

服务核验工作区、静态角色、Session、任务和运行的对应关系。错误身份或不属于当前查询的游标会被拒绝；原日志不可读时返回明确错误，不伪装成空记录。这四个接口都不启动模型、不批准工具、不确认信封，也不改变执行权限。

## 公开信息边界

页面只接收经过字段白名单处理的公开事件：用户输入或系统回注来源、助手公开回复、工具名称与状态、有限业务路径、回执、计划和证据引用。成员启动时只公开正式任务目标，不公开冻结提示词；结果回注标为系统数据，不冒充用户新指令。

原生 Session 路径、冻结角色与模块知识、私有推理事件、工具参数及原始返回正文不会直接传到页面。工具结果显示「详细正文未公开」，不能当作完整原始证据。

**公开模型回复、用户输入、目标、验收与计划中的文本未做自动秘密检测。** 字段过滤不保证识别正文里被复述的密钥、个人信息或内部路径；不要把这个历史页面当作已脱敏的对外分享材料。点击业务文件链接仍遵循既有文件打开逻辑，不授予新的执行权限。

相关说明：[成员执行](member-execution.md)、[任务派发契约](agent-dispatch-contract.md)、[全局运行监管](global-runtime-management.md)、[工作区界面](workspace-ui.md)。
