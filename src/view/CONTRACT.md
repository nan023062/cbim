# View 视图与交互

原 frontend 的页面、控制器、订阅状态、hooks 和样式迁入本目录；行为与实例状态保持原实现。main.tsx 仅挂载 App，index.html 指向新入口，资源引用和样式加载顺序不变。

页面经 window.cbim 使用 Bridge 的受限调用契约；不导入 Logic 服务、Node 或 Electron。共享算法经 Core 便携公开入口使用；foundations/utility 保留视图专属比较、订阅、异步代次、分层和存储适配，不反向依赖页面、React 或通信。订阅与代次只管理实例机制，业务状态与取消仍由控制器持有。

execution-view 的只读渲染不能反向依赖任务/会话控制器；tasks 可组合渲染与组件，但不能穿透视图库私有实现。测试按控制器或状态模块登记，页面和通信联合行为继续登记为契约/集成。
