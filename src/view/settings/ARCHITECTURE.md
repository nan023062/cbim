# src/view/settings 架构

## 目录定位

模型、资源仓库、GitHub 反馈连接、并发及新目标软限额配置。GitHub 采用 Device Flow，页面仅持公开 Client ID 与短期授权码；资源服务器账号仍为占位。并发实时状态不覆盖草稿；软限额默认关闭，显式保存与新周期生效相区分，失败保留输入且不盲目重试。 反馈预置公开产品连接；版本更新由侧栏图标与独立详情呈现，设置表单不因查看日志而卸载。 预算和反馈的动态入口验证操作请求；开启/停止共享各自使用确定签名。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [AdmissionSettings.tsx](AdmissionSettings.tsx) | 配置应用级 Agent 并发上限，展示真实准入占用与等待数量。 |
| [budget-settings-state.ts](budget-settings-state.ts) | 管理额度及显式逐请求模式草稿、版本化保存，隔离页面卸载后的异步响应；缺省仍是运行间软限额。 |
| [budget-settings.css](budget-settings.css) | 对应界面的布局与视觉样式。 |
| [BudgetSettings.tsx](BudgetSettings.tsx) | 展示用户显式配置的新目标 Token/费用软限额，与全局并发设置相邻但独立保存。 |
| [EngineSettings.tsx](EngineSettings.tsx) | 官方引擎能力列表，展示业务专长、支持接口、已配置可用模型和包管理状态。 |
| [GitHubFeedbackSettings.tsx](GitHubFeedbackSettings.tsx) | 设置页的 GitHub 反馈连接入口，展示设备授权码及固定目标仓库。 |
| [models.css](models.css) | 供应商列表和模型表单布局。 |
| [ModelSettings.tsx](ModelSettings.tsx) | 设置页的自定义供应商、连接表单与模型目录编辑器。 |
| [ProviderConnections.tsx](ProviderConnections.tsx) | 供应商表单的接口预设、自动识别和高级兼容地址编辑，以及已保存配置的按引擎连接测试。 |
| [SettingsView.tsx](SettingsView.tsx) | 模型供应商、运行并发、新目标软限额、GitHub 反馈连接、仓库与共享服务设置；版本与更新由账号菜单独立打开。 |
| [WebSettings.tsx](WebSettings.tsx) | 桌面网页配置，保存浏览器 robots 策略、Brave 开关与密钥。 |

## 架构类图

### AdmissionSettings.tsx

```mermaid
classDiagram
class N_src_view_settings_AdmissionSettings_tsx["AdmissionSettings.tsx"] {
  <<component>>
  +AdmissionSettings()
}
```

直接依赖：[../../bridge/contracts/admission.ts](../../bridge/contracts/admission.ts)、[../tasks/useAdmission.ts](../tasks/useAdmission.ts)、[../tasks/admission.css](../tasks/admission.css)。

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

直接依赖：[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)、[models.css](models.css)、[ProviderConnections.tsx](ProviderConnections.tsx)。

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

直接依赖：[../../bridge/contracts/engines.ts](../../bridge/contracts/engines.ts)、[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)、[../../bridge/contracts/model-actions.ts](../../bridge/contracts/model-actions.ts)。

### SettingsView.tsx

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
  +SettingsView()
}
```

直接依赖：[../../bridge/contracts/resources.ts](../../bridge/contracts/resources.ts)、[WebSettings.tsx](WebSettings.tsx)、[ModelSettings.tsx](ModelSettings.tsx)、[EngineSettings.tsx](EngineSettings.tsx)、[AdmissionSettings.tsx](AdmissionSettings.tsx)、[BudgetSettings.tsx](BudgetSettings.tsx)、[GitHubFeedbackSettings.tsx](GitHubFeedbackSettings.tsx)。

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
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_budget_settings_state_ts["budget-settings-state.ts"] {
  <<module>>
}
class N_src_view_settings_budget_settings_css["budget-settings.css"] {
  <<stylesheet>>
}
class N_src_view_settings_ModelSettings_tsx["ModelSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_models_css["models.css"] {
  <<stylesheet>>
}
class N_src_view_settings_ProviderConnections_tsx["ProviderConnections.tsx"] {
  <<component>>
}
N_src_view_settings_BudgetSettings_tsx ..> N_src_view_settings_budget_settings_state_ts : 导入依赖
N_src_view_settings_BudgetSettings_tsx ..> N_src_view_settings_budget_settings_css : 导入依赖
N_src_view_settings_ModelSettings_tsx ..> N_src_view_settings_models_css : 导入依赖
N_src_view_settings_ModelSettings_tsx ..> N_src_view_settings_ProviderConnections_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_WebSettings_tsx["WebSettings.tsx"] {
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
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_WebSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_ModelSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_EngineSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_AdmissionSettings_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_view_settings_SettingsView_tsx["SettingsView.tsx"] {
  <<component>>
}
class N_src_view_settings_BudgetSettings_tsx["BudgetSettings.tsx"] {
  <<component>>
}
class N_src_view_settings_GitHubFeedbackSettings_tsx["GitHubFeedbackSettings.tsx"] {
  <<component>>
}
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_BudgetSettings_tsx : 导入依赖
N_src_view_settings_SettingsView_tsx ..> N_src_view_settings_GitHubFeedbackSettings_tsx : 导入依赖
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

版本与更新由用户栏右侧的常驻图标和独立 [updates](../updates/ARCHITECTURE.md) 详情展示；设置页不重复装配更新组件。悬停图标或打开详情不会卸载设置页，模型、预算与 GitHub 反馈连接草稿继续由各表单持有。

GitHub 连接已预置公开产品配置；普通用户直接连接，高级字段保留在折叠区，不要求复制 Client ID。

`GitHubFeedbackSettings` 独立装配反馈连接；公开 Client ID、owner/repo、可见性和“连接并允许反馈自动提交”组成明确授权。后端返回短期 userCode 后，用户点击才打开固定 GitHub 登录页，页面按 nextPollAt 轮询；离开页面停止轮询，不取消已保存连接。取消／断开、错误与不可用安全存储有明确状态，失败保留配置输入。UI 不接收 token 或 device_code，也没有创建 Issue、查看逐条反馈或开发进度的 IPC。

等待文案明确要求保持设置页打开，直到本机显示“已连接”再继续反馈；网页授权成功本身不表示本机已核验并保存连接。返回设置页会恢复仍有效的 flow 轮询，不要求重复网页授权；未增加后台轮询或反馈结果通知。

```mermaid
classDiagram
class GitHubFeedbackSettings { <<component>> }
note for GitHubFeedbackSettings "GitHubFeedbackSettings.tsx：等待授权时说明页面轮询及本机已连接的完成条件；不展示 Issue 处理结果。"
```

`SettingsView` 独立装配模型、执行并发、新目标软限额和资源仓库设置，仓库服务失败不阻止配置运行策略。运行设置表单始终保留在同一渲染位置，仓库异步加载只改变仓库区域，不重挂载已可交互的表单或清除草稿。

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
