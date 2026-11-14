# src/view/settings 架构

## 目录定位

设置中心的九类导航、关键词搜索与独立表单；按需挂载并保留跨页草稿。外观偏好由 App 唯一持有并保存在本机；账号页区分本地使用与 GitHub 反馈连接。资源共享、模型、引擎、并发、预算和网页仍走原版本化服务；关于页复用更新控制器与安装详情。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [AboutSettings.tsx](AboutSettings.tsx) | 设置中心的产品版本和更新入口，读取 App 已有更新控制器。 |
| [AccountSettings.tsx](AccountSettings.tsx) | 展示本地使用模式与已有 GitHub 反馈连接，区分产品账号与外部服务账号。 |
| [AdmissionSettings.tsx](AdmissionSettings.tsx) | 配置应用级 Agent 并发上限，展示真实准入占用与等待数量。 |
| [appearance-state.ts](appearance-state.ts) | View 层的本机外观偏好、旧主题迁移与存储边界，不含账号或模型配置。 |
| [appearance.css](appearance.css) | 对应界面的布局与视觉样式。 |
| [AppearanceSettings.tsx](AppearanceSettings.tsx) | 设置中心的主题、阅读字号与动效偏好，消费外壳唯一的外观控制器。 |
| [budget-settings-state.ts](budget-settings-state.ts) | 管理额度及显式逐请求模式草稿、版本化保存，隔离页面卸载后的异步响应；缺省仍是运行间软限额。 |
| [budget-settings.css](budget-settings.css) | 对应界面的布局与视觉样式。 |
| [BudgetSettings.tsx](BudgetSettings.tsx) | 设置中心的用量与预算子页，展示用户显式配置的新目标 Token/费用软限额，与全局并发独立保存。 |
| [EmbeddingModels.tsx](EmbeddingModels.tsx) | 供应商草稿中的向量接口及模型编辑，独立输入容量、向量维度和输入计价。 |
| [EngineSettings.tsx](EngineSettings.tsx) | 官方引擎能力列表，展示业务专长、主模型与额外角色可用模型和包管理状态。 |
| [GitHubFeedbackSettings.tsx](GitHubFeedbackSettings.tsx) | 设置页的 GitHub 反馈连接入口，展示设备授权码及固定目标仓库。 |
| [models.css](models.css) | 供应商列表和模型表单布局。 |
| [ModelSettings.tsx](ModelSettings.tsx) | 设置页的自定义供应商、连接表单与模型目录编辑器。 |
| [ProviderConnections.tsx](ProviderConnections.tsx) | 供应商表单的接口预设、自动识别和高级兼容地址编辑，以及已保存配置的按操作/接口连接测试。 |
| [ResourceSettings.tsx](ResourceSettings.tsx) | 设置中心的本地资源目录与仓库共享，验证及保存由原资源服务负责。 |
| [settings-sections.ts](settings-sections.ts) | 设置中心的静态导航、分组与搜索词；仅描述已有设置入口。 |
| [settings.css](settings.css) | 对应界面的布局与视觉样式。 |
| [SettingsView.tsx](SettingsView.tsx) | 设置中心的分类导航、搜索与独立子页面；业务表单仍通过原 IPC 保存。 |
| [useAppearance.ts](useAppearance.ts) | 由 App 唯一持有的外观控制器，将本机偏好应用到窗口，并响应系统配色变化。 |
| [WebSettings.tsx](WebSettings.tsx) | 桌面网页配置，保存浏览器 robots 策略、Brave 开关与密钥。 |

## 架构类图

### AboutSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_AboutSettings_tsx["AboutSettings.tsx"] {
  <<component>>
  +AboutSettings()
}
```

直接依赖：[../components/BrandMark.tsx](../components/BrandMark.tsx)、[../../bridge/contracts/desktop-updates.ts](../../bridge/contracts/desktop-updates.ts)、[../updates/useSoftwareUpdates.ts](../updates/useSoftwareUpdates.ts)。

### AccountSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_AccountSettings_tsx["AccountSettings.tsx"] {
  <<component>>
  +AccountSettings()
}
```

直接依赖：[GitHubFeedbackSettings.tsx](GitHubFeedbackSettings.tsx)。

### AdmissionSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_AdmissionSettings_tsx["AdmissionSettings.tsx"] {
  <<component>>
  +AdmissionSettings()
}
```

直接依赖：[../../bridge/contracts/admission.ts](../../bridge/contracts/admission.ts)、[../tasks/useAdmission.ts](../tasks/useAdmission.ts)、[../tasks/admission.css](../tasks/admission.css)。

### appearance-state.ts

```mermaid
classDiagram
class N_src_view_settings_appearance_state_ts["appearance-state.ts"] {
  <<module>>
  +readAppearance()
  +saveAppearance()
  +resolveTheme()
}
```

```mermaid
classDiagram
class N_src_view_settings_appearance_state_ts["appearance-state.ts"] {
  <<module>>
}
class N_src_view_settings_appearance_state_ts_ThemePreference["ThemePreference"] {
  <<type>>

}
N_src_view_settings_appearance_state_ts ..> N_src_view_settings_appearance_state_ts_ThemePreference : 声明
class N_src_view_settings_appearance_state_ts_AppearancePreferences["AppearancePreferences"] {
  <<interface>>
  +theme
  +textSize
  +codeSize
  +reduceMotion
}
N_src_view_settings_appearance_state_ts ..> N_src_view_settings_appearance_state_ts_AppearancePreferences : 声明
class N_src_view_settings_appearance_state_ts_PreferenceStorage["PreferenceStorage"] {
  <<interface>>
  +getItem()
  +setItem()
}
N_src_view_settings_appearance_state_ts ..> N_src_view_settings_appearance_state_ts_PreferenceStorage : 声明
```


### appearance.css

```mermaid
classDiagram
class N_src_view_settings_appearance_css["appearance.css"] {
  <<stylesheet>>
}
```

### AppearanceSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_AppearanceSettings_tsx["AppearanceSettings.tsx"] {
  <<component>>
  +AppearanceSettings()
}
```

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)、[useAppearance.ts](useAppearance.ts)、[appearance-state.ts](appearance-state.ts)。

### budget-settings-state.ts

```mermaid
classDiagram
class N_src_view_settings_budget_settings_state_ts["budget-settings-state.ts"] {
  <<module>>
  +budgetSettingsInput()
}
```

```mermaid
classDiagram
class N_src_view_settings_budget_settings_state_ts["budget-settings-state.ts"] {
  <<module>>
}
class N_src_view_settings_budget_settings_state_ts_BudgetSettingsDraft["BudgetSettingsDraft"] {
  <<interface>>
  +enabled
  +tokens
  +estimatedCostUsd
  +enforcement
}
N_src_view_settings_budget_settings_state_ts ..> N_src_view_settings_budget_settings_state_ts_BudgetSettingsDraft : 声明
class N_src_view_settings_budget_settings_state_ts_BudgetSettingsState["BudgetSettingsState"] {
  <<interface>>
  +policy
  +busy
  +error
  +notice
}
N_src_view_settings_budget_settings_state_ts ..> N_src_view_settings_budget_settings_state_ts_BudgetSettingsState : 声明
N_src_view_settings_budget_settings_state_ts_BudgetSettingsDraft <|-- N_src_view_settings_budget_settings_state_ts_BudgetSettingsState
class N_src_view_settings_budget_settings_state_ts_Call["Call"] {
  <<type>>

}
N_src_view_settings_budget_settings_state_ts ..> N_src_view_settings_budget_settings_state_ts_Call : 声明
class N_src_view_settings_budget_settings_state_ts_BudgetSettingsController["BudgetSettingsController"] {
  +snapshot
  +subscribe
  +edit()
  +cancel()
  +load()
  +save()
  -call
  -state
  -generation
  -listeners
  -publish()
}
N_src_view_settings_budget_settings_state_ts ..> N_src_view_settings_budget_settings_state_ts_BudgetSettingsController : 声明
```

直接依赖：[../foundations/utility/index.ts](../foundations/utility/index.ts)、[../../bridge/contracts/scope-budget.ts](../../bridge/contracts/scope-budget.ts)。

### budget-settings.css

```mermaid
classDiagram
class N_src_view_settings_budget_settings_css["budget-settings.css"] {
  <<stylesheet>>
}
```

### BudgetSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
  +BudgetSettings()
}
```

直接依赖：[../../bridge/contracts/ipc-call.ts](../../bridge/contracts/ipc-call.ts)、[budget-settings-state.ts](budget-settings-state.ts)、[budget-settings.css](budget-settings.css)。

### EmbeddingModels.tsx

```mermaid
classDiagram
class N_src_view_settings_EmbeddingModels_tsx["EmbeddingModels.tsx"] {
  <<component>>
  +EmbeddingModels()
}
```

直接依赖：[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)。

### EngineSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_EngineSettings_tsx["EngineSettings.tsx"] {
  <<component>>
  +EngineSettings()
}
```

直接依赖：[../../bridge/contracts/engines.ts](../../bridge/contracts/engines.ts)、[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)。

### GitHubFeedbackSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_GitHubFeedbackSettings_tsx["GitHubFeedbackSettings.tsx"] {
  <<component>>
  +GitHubFeedbackSettings()
}
```

直接依赖：[../../bridge/contracts/ipc-call.ts](../../bridge/contracts/ipc-call.ts)、[../../bridge/contracts/github-feedback.ts](../../bridge/contracts/github-feedback.ts)。

### models.css

```mermaid
classDiagram
class N_src_view_settings_models_css["models.css"] {
  <<stylesheet>>
}
```

### ModelSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_ModelSettings_tsx["ModelSettings.tsx"] {
  <<component>>
  +ModelSettings()
}
```

直接依赖：[EmbeddingModels.tsx](EmbeddingModels.tsx)、[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)、[models.css](models.css)、[ProviderConnections.tsx](ProviderConnections.tsx)。

### ProviderConnections.tsx

```mermaid
classDiagram
class N_src_view_settings_ProviderConnections_tsx["ProviderConnections.tsx"] {
  <<component>>
  +ProviderConnections()
  +ProviderConnectionTest()
  +connectionTestNotice()
}
```

直接依赖：[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)、[../../bridge/contracts/model-actions.ts](../../bridge/contracts/model-actions.ts)。

### ResourceSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_ResourceSettings_tsx["ResourceSettings.tsx"] {
  <<component>>
  +ResourceSettings()
}
```

直接依赖：[../../bridge/contracts/resources.ts](../../bridge/contracts/resources.ts)。

### settings-sections.ts

```mermaid
classDiagram
class N_src_view_settings_settings_sections_ts["settings-sections.ts"] {
  <<module>>
  +findSettingsSections()
}
```

```mermaid
classDiagram
class N_src_view_settings_settings_sections_ts["settings-sections.ts"] {
  <<module>>
}
class N_src_view_settings_settings_sections_ts_SettingsSectionId["SettingsSectionId"] {
  <<type>>

}
N_src_view_settings_settings_sections_ts ..> N_src_view_settings_settings_sections_ts_SettingsSectionId : 声明
```


### settings.css

```mermaid
classDiagram
class N_src_view_settings_settings_css["settings.css"] {
  <<stylesheet>>
}
```

### SettingsView.tsx

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
  +SettingsView()
}
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_SettingsView_tsx_SettingsViewProps["SettingsViewProps"] {
  <<interface>>
  +section
  +onSectionChange
  +onBack
  +appearance
  +updates
  +onOpenUpdates
}
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_SettingsView_tsx_SettingsViewProps : 声明
```

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)、[ModelSettings.tsx](ModelSettings.tsx)、[EngineSettings.tsx](EngineSettings.tsx)、[AdmissionSettings.tsx](AdmissionSettings.tsx)、[BudgetSettings.tsx](BudgetSettings.tsx)、[WebSettings.tsx](WebSettings.tsx)、[ResourceSettings.tsx](ResourceSettings.tsx)、[AccountSettings.tsx](AccountSettings.tsx)、[AppearanceSettings.tsx](AppearanceSettings.tsx)、[AboutSettings.tsx](AboutSettings.tsx)、[settings-sections.ts](settings-sections.ts)、[useAppearance.ts](useAppearance.ts)、[../updates/useSoftwareUpdates.ts](../updates/useSoftwareUpdates.ts)、[settings.css](settings.css)。

### useAppearance.ts

```mermaid
classDiagram
class N_src_view_settings_useAppearance_ts["useAppearance.ts"] {
  <<module>>
  +useAppearance()
}
```

```mermaid
classDiagram
class N_src_view_settings_useAppearance_ts["useAppearance.ts"] {
  <<module>>
}
class N_src_view_settings_useAppearance_ts_AppearanceController["AppearanceController"] {
  <<interface>>
  +value
  +resolvedTheme
  +error
  +update
  +reset
  +retry
}
N_src_view_settings_useAppearance_ts ..> N_src_view_settings_useAppearance_ts_AppearanceController : 声明
```

直接依赖：[appearance-state.ts](appearance-state.ts)、[appearance.css](appearance.css)。

### WebSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_WebSettings_tsx["WebSettings.tsx"] {
  <<component>>
  +WebSettings()
}
```

直接依赖：[../../bridge/contracts/ipc-settings.ts](../../bridge/contracts/ipc-settings.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_view_settings_AccountSettings_tsx["AccountSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_GitHubFeedbackSettings_tsx["GitHubFeedbackSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_AppearanceSettings_tsx["AppearanceSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_useAppearance_ts["useAppearance.ts"] {
  <<module>>
}
class N_src_view_settings_appearance_state_ts["appearance-state.ts"] {
  <<module>>
}
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_budget_settings_state_ts["budget-settings-state.ts"] {
  <<module>>
}
N_src_view_settings_AccountSettings_tsx ..> N_src_view_settings_GitHubFeedbackSettings_tsx : 导入依赖
N_src_view_settings_AppearanceSettings_tsx ..> N_src_view_settings_useAppearance_ts : 导入依赖
N_src_view_settings_AppearanceSettings_tsx ..> N_src_view_settings_appearance_state_ts : 导入依赖
N_src_view_settings_BudgetSettings_tsx ..> N_src_view_settings_budget_settings_state_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_budget_settings_css["budget-settings.css"] {
  <<stylesheet>>
}
class N_src_view_settings_ModelSettings_tsx["ModelSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_EmbeddingModels_tsx["EmbeddingModels.tsx"] {
  <<component>>
}
class N_src_view_settings_models_css["models.css"] {
  <<stylesheet>>
}
class N_src_view_settings_ProviderConnections_tsx["ProviderConnections.tsx"] {
  <<component>>
}
N_src_view_settings_BudgetSettings_tsx ..> N_src_view_settings_budget_settings_css : 导入依赖
N_src_view_settings_ModelSettings_tsx ..> N_src_view_settings_EmbeddingModels_tsx : 导入依赖
N_src_view_settings_ModelSettings_tsx ..> N_src_view_settings_models_css : 导入依赖
N_src_view_settings_ModelSettings_tsx ..> N_src_view_settings_ProviderConnections_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_ModelSettings_tsx["ModelSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_EngineSettings_tsx["EngineSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_AdmissionSettings_tsx["AdmissionSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
}
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_ModelSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_EngineSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_AdmissionSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_BudgetSettings_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_WebSettings_tsx["WebSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_ResourceSettings_tsx["ResourceSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_AccountSettings_tsx["AccountSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_AppearanceSettings_tsx["AppearanceSettings.tsx"] {
  <<component>>
}
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_WebSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_ResourceSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_AccountSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_AppearanceSettings_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_AboutSettings_tsx["AboutSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_settings_sections_ts["settings-sections.ts"] {
  <<module>>
}
class N_src_view_settings_useAppearance_ts["useAppearance.ts"] {
  <<module>>
}
class N_src_view_settings_settings_css["settings.css"] {
  <<stylesheet>>
}
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_AboutSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_settings_sections_ts : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_useAppearance_ts : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_settings_css : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_useAppearance_ts["useAppearance.ts"] {
  <<module>>
}
class N_src_view_settings_appearance_state_ts["appearance-state.ts"] {
  <<module>>
}
class N_src_view_settings_appearance_css["appearance.css"] {
  <<stylesheet>>
}
N_src_view_settings_useAppearance_ts ..> N_src_view_settings_appearance_state_ts : 导入依赖
N_src_view_settings_useAppearance_ts ..> N_src_view_settings_appearance_css : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

### 网页与搜索

WebSettings 显示浏览器 robots 策略（默认允许读正文、可选遵守规则）、Brave Search API 开关与密码输入；明确查询词发送给供应商。策略不依赖搜索密钥，可在安全存储不可用时保存。保存成功清空密钥输入，移除密钥同时关闭搜索；无安全存储时禁填密钥。版本冲突刷新配置摘要，保留未成功保存的密钥输入；不提供密钥读取或测试搜索自动调用。

# 设置界面

版本与更新由用户栏图标、设置中心“关于与更新”和独立 [updates](../updates/ARCHITECTURE.md) 详情展示。App 持有唯一更新控制器；设置页只读取同一状态或显式检查，日志入口打开原模态框，不重建轮询、不卸载表单。重启安装仍由原详情显式触发。

GitHub 连接已预置公开产品配置；普通用户直接连接，高级字段保留在折叠区，不要求复制 Client ID。

`GitHubFeedbackSettings` 独立装配反馈连接；公开 Client ID、owner/repo、可见性和“连接并允许反馈自动提交”组成明确授权。后端返回短期 userCode 后，用户点击才打开固定 GitHub 登录页，页面按 nextPollAt 轮询；离开页面停止轮询，不取消已保存连接。取消／断开、错误与不可用安全存储有明确状态，失败保留配置输入。UI 不接收 token 或 device_code，也没有创建 Issue、查看逐条反馈或开发进度的 IPC。

等待文案明确要求保持设置页打开，直到本机显示“已连接”再继续反馈；网页授权成功本身不表示本机已核验并保存连接。返回设置页会恢复仍有效的 flow 轮询，不要求重复网页授权；未增加后台轮询或反馈结果通知。

```mermaid
classDiagram
class GitHubFeedbackSettings { <<component>> }
note for GitHubFeedbackSettings "GitHubFeedbackSettings.tsx：等待授权时说明页面轮询及本机已连接的完成条件；不展示 Issue 处理结果。"
```

`SettingsView` 使用 `settings-sections` 的九类静态导航和多关键词搜索；搜索只筛选入口，不自动选页或调用业务。外壳传入当前分类，支持账号菜单、模型和仓库入口直达。设置中心独占主区域，返回恢复原工作区选择；窄内容区使用分类下拉和可搜索入口。

每个分类首次访问才挂载，之后使用 hidden 保留表单草稿，离开设置中心才卸载。仓库加载失败只显示于 ResourceSettings，不能阻塞其它分类。隐藏运行页退订共享准入快照；GitHub 授权流程在设置中心内换页时继续原有轮询，离开中心时清理。EngineSettings 返回可见分类或完成操作后刷新包与已保存模型，忙碌时不启动额外读取，旧读取在操作/切页时失效。

`AdmissionSettings` 从可靠设置读取版本，显式保存 1～32 的全局运行上限。输入草稿不随占用变化重置；版本冲突后由用户刷新确认。`useAdmission` 与会话共用一个窗口级游标订阅，显示实际占用/上限和等待数量；降低上限可以暂时出现占用高于上限，不结束已有任务。读取失败保留旧数据并明确可能过期。

`BudgetSettings` 默认关闭，用户至少明确一项 Token / 美元额度才可启用。`budget-settings-state` 保留草稿和期望版本，显式读取/保存、不轮询、不重复提交；读取未成功时禁用表单，保存失败保留输入，未知结果先刷新核实。禁用提交清除额度；重新启用须重新明确。设置只冻结到之后创建的周期，既有目标和 waiting 不受全局改配影响。

界面明确“运行间软限额”：单轮中的多个请求、重试或自动摘要可能超额；在途须先结算，用量未知不能按零放行，同周期启用后串行结算。设置页不领取运行、不解除审批、不消费 waiting 或恢复历史；真正启动仍由调度事务、知识基线、成员及工作区租约检查。

## 逐请求预算（R06）

用户可显式勾选逐请求预留；缺省仍为旧软限额。草稿和版本保存模式，说明保守模型容量预留、未知保持占用及本地估价。读取失败不显示为关闭，设置不自动保存，也不改变旧目标。

### 统一供应商模型目录

供应商表单保存主连接、一份凭据、模型目录与可选兼容接口，不为每个引擎复制供应商。ProviderConnections 提供官方预设、精确地址识别开关、自定义兼容地址和适用型号编辑；预览只显示默认模型的推导地址，不联网。主协议/地址或兼容接口草稿变更清空当前输入凭据及已发现目录，已保存目录保持不变；旧 engine 字段编辑保存时移除。

ProviderConnectionTest 在供应商卡片中明确选择已保存型号和测试引擎，展示实际协议与目标地址；仅点击测试才发送一次短文本请求，成功显示实际接口及“仅文本请求”，失败保留目录与选择。编辑、取消和切换测试菜单不探测网络。Agent 选型不因测试改变，更新供应商不热替换已启动运行。


### 预算设置订阅边界

BudgetSettingsController 使用前端 SubscriptionSet，只在发布新状态后同步通知监听器；订阅和退订不读写设置。cancel、草稿保留、版本与保存失败策略仍归控制器，集合不拥有状态或 IPC。


### 异步结果失效边界

BudgetSettingsController 组合前端 AsyncGeneration。load/save 开始和 cancel 推进代次；成功、失败与 finally 分别在原位置判断标记，避免旧结果覆盖新草稿或清掉新请求的 busy。配置版本校验、单次提交及未知保存结果策略仍属于设置控制器，代次不作为后端版本。

EngineSettings 展示官方业务专长、兼容模型、版本与依赖，查询不激活；安装提交显示的摘要和 revision。错误后刷新真实状态并保留原错误，不自动重试。与模型编辑表单独立，刷新引擎列表不会提交模型草稿。

EmbeddingModels 编辑明确向量端点、输入容量、维度和可选输入价，不填生成输出字段；纯向量供应商允许保存。编辑既有供应商保留 embedding；端点改变清输入中的 Key，保存仍由服务强制凭据重确认。连接预览/测试只选模型能力与接口，不要求用户了解引擎。

### 外观与账号的边界

`appearance-state` 校验本机主题、对话字号、代码块字号及减少动效。无新记录时继承 `cbim.theme`；单键 `cbim.appearance.v1` 保存，不读取或改写工作区、凭据。损坏字段回退，读取失败不覆盖原记录；写入失败仍可预览但明确本窗口有效，并提供重试。恢复默认只改外观。

`useAppearance` 由 App 唯一挂载，监听系统配色并将实际深浅模式及阅读变量写入根节点；选择“跟随系统”不会被解析结果改写。正文字号仅影响聊天消息，代码字号仅影响聊天代码块。减少动效和系统偏好共同生效。账号菜单快捷主题与 AppearanceSettings 共用此控制器。

`AccountSettings` 明确 CBIM 当前本地使用、无云账号及跨设备同步；实际外部账号仍由 GitHubFeedbackSettings 管理，无伪登录或退出按钮。`ResourceSettings` 保留原目录验证与共享的显式启停，连接令牌仅在点击后读取。
