# 模块 UX 设计

在仓库根目录执行 `node design-ux/review/architecture-design-check.cjs` 核对模块配置和设计链接；执行 `node design-ux/review/architecture-local-review.cjs` 使用本机浏览器离线验证并导出两个页面的截图。

模块配置直达：[Office 节点与交付物](src/view/office/CONFIG.md) · [扩展面板节点与交付物](src/view/extension/CONFIG.md) · [商城节点与交付物](src/view/discovery/CONFIG.md)。

每个模块同时维护 README.md 与 CONFIG.md。新模块的 CONFIG.md 先链接实现依据，再逐行填写「业务节点路径｜模块用途｜产出物文件或业务结果｜可核验的交付标准」，注明示例与计划交付。已有共享资产使用相对链接。

按源码相对路径查找模块设计。例如业务与组织视图在 `src/view/office/`，对应的设计位于 `design-ux/src/view/office/`。交互设计可先于正式功能落地。

| 模块 | 入口 | 关联场景 |
| --- | --- | --- |
| Office | [业务与组织架构](src/view/office/README.md) | 节点配置、职责与岗位联动 |
| 扩展面板 | [扩展标签与面板宽度](src/view/extension/README.md) | 宽面板、窄面板与返回 |
| 资源发现 | [资源商城](src/view/discovery/README.md) | 商品浏览、授权与安装 |

新增模块时按真实源码路径建目录。在模块 README 记录用户入口、源码、关联测试、验证步骤及可打开的设计资产。有实际内容时再建档。跨模块交互由主视图维护一份原型，其余模块通过相对链接和锚点引用。页面字号、主题、焦点和断点遵循[全局桌面规范](../design/desktop-ux-spec.md)。
