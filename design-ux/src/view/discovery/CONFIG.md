# 资源商城配置

执行引擎管理页共用本视图模块。LogoLabel 用于引擎列表、详情标题与依赖引擎名称；安装、进度、版本状态和详情仍由 EnginePackagesView 维护。页面使用 `<LogoLabel data={engineLogoLabel(id,name,src,selected)} onActivate={setSelected} />`。省略回调时为静态展示。禁用原因由数据提供，键盘与鼠标均只上报 id。试跑入口为 `node design-ux/review/named-mark-check.cjs`。

[商城视图](../../../../src/view/discovery/MenuViews.tsx)提供页面入口，资源生命周期参考[资源体系](../../../../design/resource-system.md)。以下节点路径用于设计映射。

| 节点路径 | 模块用途 | 产出物 | 交付标准 |
| --- | --- | --- | --- |
| CBIM 客户端 / 资源商城 / 资源目录 | 分类浏览资源、查看版本与预览 | [商城交互原型](resource-market-preview.html) | 从商品详情返回后能找到原商品 |
| CBIM 客户端 / 资源商城 / 资源安装 | 查看采用方式和资源权益 | [商城交互设计](resource-market-ux.md)与采用后的商品状态（示例结果） | 确认操作后正确更新商品状态，取消保留原状态 |

业务结果保存在设计演示范围内。节点名称用于评审定位，运行时配置以项目实际数据为准。
