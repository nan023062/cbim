# src/backend/main/persistence/settings 架构

## 目录定位

应用级模型、并发与新目标软限额存储。密钥系统加密；策略串行版本校验与原子保存，缺文件才使用默认值。软限额只冻结新周期，设置恢复不重放模型或改变既有目标。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [admission-settings.ts](admission-settings.ts) | 持久化应用级并发上限，并在工作区装配前恢复准入策略。 |
| [budget-settings.ts](budget-settings.ts) | 可靠保存应用的新目标软限额默认值，供调度器在创建周期时冻结。 |
| [llm-profiles.ts](llm-profiles.ts) | 本机供应商配置持久化、默认模型选择和连接检测。 |

## 架构类图

### admission-settings.ts

```mermaid
classDiagram
class N_src_backend_main_persistence_settings_admission_settings_ts["admission-settings.ts"] {
  <<module>>
}
class N_src_backend_main_persistence_settings_admission_settings_ts_AdmissionSettingsStorage["AdmissionSettingsStorage"] {
  <<interface>>
  +read()
  +write()
}
N_src_backend_main_persistence_settings_admission_settings_ts ..> N_src_backend_main_persistence_settings_admission_settings_ts_AdmissionSettingsStorage : 声明
class N_src_backend_main_persistence_settings_admission_settings_ts_AdmissionSettings["AdmissionSettings"] {
  +init()
  +read()
  +configure()
  -filename
  -admission
  -storage
  -pending
  -initialized
  -serial()
}
N_src_backend_main_persistence_settings_admission_settings_ts ..> N_src_backend_main_persistence_settings_admission_settings_ts_AdmissionSettings : 声明
```

直接依赖：[../../../core/foundation/files.ts](../../../core/foundation/files.ts)、[../../../core/foundation/errors.ts](../../../core/foundation/errors.ts)、[../../../core/runtime/admission.ts](../../../core/runtime/admission.ts)、[../../../scheduler-engine/runtime/run-admission.ts](../../../scheduler-engine/runtime/run-admission.ts)。

### budget-settings.ts

```mermaid
classDiagram
class N_src_backend_main_persistence_settings_budget_settings_ts["budget-settings.ts"] {
  <<module>>
}
class N_src_backend_main_persistence_settings_budget_settings_ts_BudgetSettingsStorage["BudgetSettingsStorage"] {
  <<interface>>
  +read()
  +write()
}
N_src_backend_main_persistence_settings_budget_settings_ts ..> N_src_backend_main_persistence_settings_budget_settings_ts_BudgetSettingsStorage : 声明
class N_src_backend_main_persistence_settings_budget_settings_ts_BudgetSettings["BudgetSettings"] {
  +init()
  +read()
  +configure()
  -filename
  -storage
  -policy
  -pending
  -serial()
}
N_src_backend_main_persistence_settings_budget_settings_ts ..> N_src_backend_main_persistence_settings_budget_settings_ts_BudgetSettings : 声明
```

直接依赖：[../../../core/foundation/files.ts](../../../core/foundation/files.ts)、[../../../core/foundation/errors.ts](../../../core/foundation/errors.ts)、[../../../core/tasks/scope-budget.ts](../../../core/tasks/scope-budget.ts)。

### llm-profiles.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_persistence_settings_llm_profiles_ts["llm-profiles.ts"] {
  <<module>>
}
class N_src_backend_main_persistence_settings_llm_profiles_ts_DiskProfile["DiskProfile"] {
  <<interface>>
  +id
  +encryptedKey
}
N_src_backend_main_persistence_settings_llm_profiles_ts ..> N_src_backend_main_persistence_settings_llm_profiles_ts_DiskProfile : 声明
class N_src_backend_main_persistence_settings_llm_profiles_ts_external_LlmDefinition["LlmDefinition (外部契约)"] {
  <<external>>
}
N_src_backend_main_persistence_settings_llm_profiles_ts_external_LlmDefinition <|-- N_src_backend_main_persistence_settings_llm_profiles_ts_DiskProfile
class N_src_backend_main_persistence_settings_llm_profiles_ts_ModelFile["ModelFile"] {
  <<interface>>
  +version
  +selectedId
  +profiles
}
N_src_backend_main_persistence_settings_llm_profiles_ts ..> N_src_backend_main_persistence_settings_llm_profiles_ts_ModelFile : 声明
class N_src_backend_main_persistence_settings_llm_profiles_ts_LlmProfiles["LlmProfiles"] {
  +list()
  +save()
  +select()
  +remove()
  +resolve()
  +configuration()
  +discover()
  +discoverDetails()
  +test()
  -filename
  -cipher
  -queue
  -read()
  -view()
  -change()
  -decrypt()
}
N_src_backend_main_persistence_settings_llm_profiles_ts ..> N_src_backend_main_persistence_settings_llm_profiles_ts_LlmProfiles : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_persistence_settings_llm_profiles_ts["llm-profiles.ts"] {
  <<module>>
}
class N_src_backend_main_persistence_settings_llm_profiles_ts_LlmProfiles["LlmProfiles"] {
  -headers()
  -request()
}
N_src_backend_main_persistence_settings_llm_profiles_ts ..> N_src_backend_main_persistence_settings_llm_profiles_ts_LlmProfiles : 声明
```

直接依赖：[../../../core/brain/llm/catalog.ts](../../../core/brain/llm/catalog.ts)、[../../../core/foundation/files.ts](../../../core/foundation/files.ts)、[../../../core/foundation/errors.ts](../../../core/foundation/errors.ts)、[../../../core/brain/llm/config.ts](../../../core/brain/llm/config.ts)、[../../../core/brain/llm/ports.ts](../../../core/brain/llm/ports.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# 本机设置持久化边界

`LlmProfiles` 管理供应商和模型配置，凭据通过平台注入的加密接口保存，运行时才解密。`AdmissionSettings` 独立管理全局执行并发配置，不能读取或修改模型凭据。

`configuration(profileId,modelId)` 供岗位登记读取明确选定的公开模型快照，与真实运行的 `resolve` 共用同一纯选型函数。必须给出两个标识，不使用默认选择，不解密、不调用网络；无供应商、缺模型或禁用模型会拒绝。输出只包含实际运行公开 profile 字段，不含 apiKey、encryptedKey、hasKey 或默认选择。配置可读不代表凭据有效或模型可执行；只有原 `resolve` 在选型之后进入解密。

并发设置文件只保存 `version:1` 与 `policy:{revision,maxConcurrentRuns}`。默认 4，允许 1～32；应用在打开工作区前初始化一次，缺文件使用默认值，损坏文件明确失败而不覆盖。`read()` 只读已生效策略，`configure()` 用原版本串行校验，原子写盘成功后同步交给准入器。写入失败保持原限额，版本冲突要求刷新；降低上限不结束现有执行。

`BudgetSettings` 独立保存新周期默认软限额 `version:1 + policy:{revision,enabled,limits}`。默认关闭，启用须明确正整数 Token 或正数估算美元；应用装配前恢复，只有缺文件可默认关闭。损坏配置明确失败；串行版本校验和原子写入通过后才更新内存，读取返回深拷贝。新周期冻结策略，已有周期不跟随设置改变，设置本身不保存或更改用量。

此目录不保存等待票据或执行许可。票据只属于当前进程的可信启动安排；重启不能通过设置文件自动恢复任务。并发数与周期软限额不同，后者仅在真实运行之间核实，不保证一次 Pi 内多个请求、重试和摘要的硬账单上限。
