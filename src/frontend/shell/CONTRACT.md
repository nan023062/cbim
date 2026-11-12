# 工作区外壳与原会话定位

对话列表与会话历史菜单共用 `ConversationEntries` 和本机 `TabLayout`：自定义标题不覆盖原任务目标，移除条目保存工作区隔离的 `hiddenTaskIds`，轮询和重开不复活；删除最后一项创建空对话，不停止后台运行或删除日志。运行总览的显式定位可以恢复被移除条目。红色运行灯取 `runtime.snapshot` 的 ready 工作区及实际主／成员 running 记录，排队、历史状态和持久等待不点亮，读取失败清除观察。工作区菜单使用 portal 以点击坐标锚定左上角，视口边缘避让，支持键盘与焦点返回；折叠按钮紧邻项目名。

`ExtensionArea` 向业务架构传递完整的 `WorkspaceView` 与共享快照，使负责人入口复用项目岗位登记时仍核实真实运行状态和实例。登记、返回原模块及选择状态由业务视图持有；外壳不生成岗位或执行责任写入。

`App` 保存工作区页签、草稿与附件，界面选择不代表后端运行。全局“运行管理”挂载独立只读 `RuntimeOverview`；离开该页卸载其读取，不创建或恢复任务。

展开侧栏仅显示“团队空间”文字及收起按钮，不重复展示 CBIM/BrandMark；窄侧栏也保留文字。欢迎页仍展示完整名称 CBIM Assistant 与 BrandMark。标题变化不改变账号、工作区、侧栏伸缩或品牌资源。

用户栏右侧原主题按钮改为常驻更新图标；账号菜单只保留设置、主题和账号项，不重复更新入口或绿点。`App` 持有唯一 `useSoftwareUpdates`，把同一个 controller 交给 `UserMenu` 内的 `SoftwareUpdateButton`、新版提醒和详情。图标悬停或聚焦只读版本和进度；仅 ready 时点击安装，未就绪不打开弹窗、不下载、不排队安装。具体进度环、呼吸与错误语义归 updates。主题切换仍由 UserMenu 的菜单项调用原回调。详情从新版提醒打开，不切换 screen 或卸载原会话和设置草稿。

更新呈现独立归入 [updates](../updates/ARCHITECTURE.md)，通过固定 IPC 依赖公开更新契约，不将账号登录、菜单展示或弹窗状态放进 backend/updater。菜单位置是本次已确认的变化点；检查、下载与排空安装的规则保持原后端归属，变化频率没有统计结论。

```mermaid
classDiagram
class App { <<component>> }
class UserMenu { <<component>> }
class SoftwareUpdates { <<external component>> }
class SoftwareUpdateButton { <<external component>> }
class useSoftwareUpdates { <<external module>> }
class BrandMark { <<external component>> }
App ..> BrandMark : 欢迎页产品标识
App ..> UserMenu : 提供唯一更新 controller
UserMenu ..> SoftwareUpdateButton : 用户栏右侧常驻入口
App ..> useSoftwareUpdates : 持有窗口级状态
App ..> SoftwareUpdates : 叠加弹窗，保留原页面
note for SoftwareUpdates "../updates/SoftwareUpdates.tsx：只消费更新状态与显式操作"
```

运行页的 `onOpen` 只携带 `workspaceId/rootSessionId` 与可选 `scopeId/taskId`。`RuntimeNavigationResolver` 依次读取工作区清单、该工作区的 `loop.list`、再次读取清单，要求同一实例始终为 running，且原根存在真实 chat 记录并属于该工作区。缺失、不可读或身份冲突明确失败，不调用 open、chat、resume、dispatch 或重试接口。

导航只复用已绑定该根的聊天页签；本机没有页签时，新增绑定真实历史的页签，不挪用未发送草稿页签，不改原标题、草稿或附件。两次点击不会建立重复绑定。切屏、新导航和卸载使旧请求失效，迟到失败也不覆盖新页面。工作区实例变化重新挂载会话投影，原本机草稿保持。

一次性 `RuntimeNavigationRequest` 交给 `Conversation`；任务图与周期加载完成后再次核对原身份并消费。选中旧周期仅影响展示，不改变实际开放目标。消费后请求清除，后续轮询或返回对话不会重复重置用户选择；不存在节点和周期不回退为最新目标。

扩展区将真实治理启动回执交给 Shell，按原工作区绑定新会话，不覆盖其他草稿。右上运行绿点与展开工作区详情入口已移除；工作区管理在左侧更多菜单中保留，不删除后台状态或既有任务。团队文件编辑与业务编辑共用页签离开保护。

## 自动化会话定位

App 将自动化历史的真实 taskId 交给 showStartedTask，复用已有会话或新建条目，保留原草稿和附件；不重新运行任务。右侧旧自动化条目复用同一工作区视图，不建立第二份配置或调度服务。
