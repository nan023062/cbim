# View 视图与交互

`styles.ts` 集中静态装配当前全部页面 CSS，顺序为外壳、业务布局、统一 interface 规则；页面 JavaScript 延迟加载不会再迟到注入样式改变覆盖关系。新增 CSS 文件须同步该清单。`main.tsx` 只导入该样式入口。App 与 ExtensionArea 的专业页面通过局部 deferredView 装配；样式仍首屏加载，不能把 JavaScript 按需加载称为全部资源按需。

原 frontend 的页面、控制器、订阅状态、hooks 和样式迁入本目录；行为与实例状态保持原实现。main.tsx 挂载 App，index.html 指向该入口。业务样式、外壳样式之后加载 components/interface.css，使所有页面共享主题令牌、控件焦点、字号下限及减少动效规则。

页面经 window.cbim 使用 Bridge 的受限调用契约；不导入 Logic 服务、Node 或 Electron。共享算法经 Core 便携公开入口使用；foundations/utility 保留视图专属比较、订阅、异步代次、分层和存储适配，不反向依赖页面、React 或通信。订阅与代次只管理实例机制，业务状态与取消仍由控制器持有。

execution-view 的只读渲染不能反向依赖任务/会话控制器；tasks 可组合渲染与组件，但不能穿透视图库私有实现。测试按控制器或状态模块登记，页面和通信联合行为继续登记为契约/集成。
