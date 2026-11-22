# 业务与组织架构配置

Office 的引擎选择菜单与展开态引擎按钮使用引擎图标和名称。原生按钮继续负责弹出菜单、选中提示和键盘操作。紧凑输入区仅显示引擎图标；模型使用文本，连接器按配置顺序排列图标。

正式客户端通过 [NamedMark 与资源图标](../../../../src/framework-ui/ResourceLogo.tsx)展示引擎、技能和工作流。logic 以只读数据提供 id、name、logo、fallback、tooltip 和可选的 selected、disabled、disabledReason。静态展示传入 data；可操作的引擎选项使用 `<NamedMark data={option} onActivate={id => selectEngine(id)} />`。父页面保存选择并更新 data。模型保留文字，连接器勾选顺序由页面维护。技能书和流程节点使用当前主题文字色，在自定义图片解码期间占据同一个 20px 方框。成功后显示原图，失败保留当前主题的默认图。仓库包封面与内部对象 Logo 独立。

业务树与组织树的展示依据见 [BusinessPanel](../../../../src/view/office/BusinessPanel.tsx) 和 [OrganizationPanel](../../../../src/view/office/OrganizationPanel.tsx)。以下节点路径及业务交付物是[可点击原型](architecture-preview.html)的示例。

| 节点路径 | 模块用途 | 产出物 | 交付标准 |
| --- | --- | --- | --- |
| CBIM 客户端 / 资源商城 | 编排目录审核与交付 | 资源目录清单（示例业务结果） | 每项可定位来源，版本与交付一致 |
| 资源商城 / 资源目录、资源安装 | 维护子工作区来源与交付范围 | 独立保存的步骤和产出物列表（示例业务结果） | 修改一个节点，父节点与兄弟节点保持各自内容 |
| CBIM 客户端 / 引擎管理 / 模型选择 | 管理引擎及模型范围 | 引擎版本回退报告（引擎管理节点示例） | 可卸载重装指定版本，重启后仍识别目标版本 |
| 业务负责人关联的资源团队、资源维护岗 | 查看或维护节点专属技能 | [组织预览](organization-architecture-preview.png)和本地技能配置 | 同名技能在本节点防重，团队与岗位分别保存 |

业务结果保存在设计演示范围内。节点名称用于评审定位，运行时配置以项目实际数据为准。

岗位执行配置的选择规则参照 [主 Agent 选择器](../../../../src/view/office/MainAgentPicker.tsx)及[连接器设置](../../../../src/view/office/AgentSettingsDialog.tsx)。示例引擎显示内联 Logo 与完整名称；无图使用终端图标。模型只显示完整名称，连接器按加入顺序显示 Logo，点击或聚焦可核对名称。每个岗位独立保存，团队没有这组选项。
