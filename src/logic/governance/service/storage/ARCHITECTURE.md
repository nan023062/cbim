# src/logic/governance/service/storage 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../../../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

知识治理记录的物理持久化；业务规则和不可变意见契约在 logic/governance/rules，应用治理服务在父目录。

## 类与模块的设计意图

下表依据源码声明及文件头说明定位封装。字段表示该实例持有的状态或协作引用，不表示它拥有被引用服务的生命周期；实际资源责任和调用限制见下文契约及源码注释。

| 类／模块 | 实现形式与实例字段 | 封装依据 |
| --- | --- | --- |
| [ModuleGovernanceStore](module-governance-store.ts) | 实例类；持有 `commands`、`anchor`、`uncertain`、`filename`、`workspaceId` | 文件是用户应用数据，不属于 .cbim；正文、决定和身份均通过完整链校验后才供门禁使用。 |

## 接口设计契约

<a id="contract"></a>

<a id="contract-私有治理账本"></a>

### 私有治理账本

每个工作区在用户数据目录保存 `governance/module-ledger.json`，不进入 `.cbim`、资源包或普通知识 CRUD。账本最多 512 条命令、32 MiB；超限拒绝新写，不裁剪历史。完整输入、稳定命令、回执及可选实施意图构成唯一追加链，加载时核身份、指纹、登记/观察/提案/决定顺序以及实施所引用的当时批准。

观察与提案可携带可信 origin，私有命令封装与公开记录必须逐字段一致，且参与原请求指纹。模型来源还须从工作区、根会话、run、toolCallId 与工具名重算相同命令 UUID；模型提案的原观察须属于同一主实例及逻辑通道。新桌面记录明确标注本机操作；旧记录缺省沿用旧指纹，不补造来源，不得冒领为模型调用。登记、决定和实施不接受模型 origin。

反馈、回应引用和评价同样是原命令/记录的一部分。新增提案按当前已见来源冻结 respondsTo，决定中的 feedback/assessments 须与原输入一致；批准、带评价的决定及实施意图在其出现时复核来源仍 current。加载完整账本按持久命令顺序核验，不拿末尾最新意见否认前面当时合法的记录。当前展示的 superseded 不写回历史；可选旧字段缺省不自动补空数组或 addressed。

`module-ledger.json.anchor` 绑定账本 UUID、命令数量及完整文件字节哈希。首次创建空账本和锚完成后才发布服务；旧锚存在但账本丢失、合法 JSON 被回退为空、删除完整分支或来源不一致都失败关闭，不能重新初始化为空保护。

写入顺序为锚 pending → 原子替换账本 → 确认锚 head。任一步失败，本实例拒绝继续读写治理或绕过知识门禁。重开只接受精确旧 head 或精确下一 pending：完成相应元数据确认，不执行知识事务。该协议没有承诺抵抗同时替换全部私有用户数据，也不把账本持久化称为跨存储原子知识提交。

存储不持有工作区、不自建回调队列。调用方负责持有 KnowledgeStore 串行屏障；落盘成功后才发布内存状态。实施结果不写入可自证成功的缓存，知识 journal 仍是唯一正式提交来源。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [module-governance-store.ts](module-governance-store.ts) | 源码模块 | 保存工作区私有的保护登记、观察、提案、决定及原实施意图。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

### module-governance-store.ts

```mermaid
classDiagram
class N_src_logic_governance_service_storage_module_governance_store_ts["module-governance-store.ts"] {
  <<module>>
  +governanceCommandFingerprint()
}
```

```mermaid
classDiagram
class N_src_logic_governance_service_storage_module_governance_store_ts["module-governance-store.ts"] {
  <<module>>
}
class N_src_logic_governance_service_storage_module_governance_store_ts_GovernanceCommand["GovernanceCommand"] {
  <<type>>

}
N_src_logic_governance_service_storage_module_governance_store_ts ..> N_src_logic_governance_service_storage_module_governance_store_ts_GovernanceCommand : 声明
class N_src_logic_governance_service_storage_module_governance_store_ts_ModuleGovernanceStore["ModuleGovernanceStore"] {
  +workspaceId
  +constructor()
  +Init()
  +All()
  +Find()
  +Append()
  -filename
  -commands
  -anchor
  -uncertain
  -anchorFile
  -Bytes()
  -Current()
  -Validate()
}
N_src_logic_governance_service_storage_module_governance_store_ts ..> N_src_logic_governance_service_storage_module_governance_store_ts_ModuleGovernanceStore : 声明
```

直接依赖：[../../../../core/errors.ts](../../../../core/errors.ts)、[../../../../core/platform/node/files/index.ts](../../../../core/platform/node/files/index.ts)、[../../../../core/platform/node/serialization.ts](../../../../core/platform/node/serialization.ts)、[../../rules/module-governance-feedback.ts](../../rules/module-governance-feedback.ts)、[../../rules/module-governance-rules.ts](../../rules/module-governance-rules.ts)、[../../rules/module-governance.ts](../../rules/module-governance.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
