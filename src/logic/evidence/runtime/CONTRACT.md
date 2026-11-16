
## 递归业务影响观察

EffectSourcePorts 使用最小 BusinessRunSource；effect-source 对 agentBusinessRuns 明确走递归协议分支，核对原父引用、冻结岗位/模块、任务根路径、memberBinding、原生会话和完整 canonical。新来源不借用旧派工任务或成员会话，不伪造 taskRevision/planRevision。报告的 executionModel 标识可信递归来源；状态戳包含本根登记，读取期间关闭变化使依据失效。影响与处置仍不重写工具终态，不执行模型或文件命令。

## 递归业务产物报告

ArtifactReportService 与 OutputManifestReportService 读取同一 DispatchStore 的 agentBusinessRuns，明确 task/run/root 后使用独立 inspectAgent 固定日志端口；不造旧图节点、模型快照或派发状态。recursive-evidence-source 共用唯一周期/登记与 canonical 的父调用、模块、岗位、原生通道和连续事件核验。active 登记仅表示原启动意图；可列可信历史引用，但只有 closed 与真实终态同时成立才复核当前文件。读取前后比较原登记和日志，变化即 unverifiable；范围、哈希、只读占用及脱敏仍由原报告服务负责。旧报告路径和错误语义保留。


## 递归执行记录核实

执行记录报告同样按 agentBusinessRuns 读取原子调用；执行模型明确为 agent-tools-v1，不制造旧 taskRevision/taskStatus 或交付候选。active/closed 是登记状态，只有闭合登记与可信日志终态一致才 settled；未选择运行不读取最新日志。沿用工具授权/回执核验及分页，坏正文、缺失日志和读后登记变化保持 unknown；读取不启动引擎。


## 普通交付文件的再次核实
[AgentArtifactVerification](agent-artifact-verification.ts) 是无状态静态封装。它只组合既有 verifyArtifactBaselines 与注入的受限 checkFiles，读取原采集绑定、知识版本及成功授权链，拒绝损坏或全部已失效的采集。只复核当前有效基线列出的文件，逐项核对返回的路径、expected、observed 和 matches，不把文件集合称为完整影响范围。没有采集时返回空文件集合，不补采或伪造基线。调用方负责 canonical 完整身份与工作区生命周期；后续增加采集来源仍修改原 artifact-evidence 规则，不另建验证协议。
