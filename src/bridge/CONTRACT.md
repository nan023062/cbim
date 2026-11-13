# 桥接层

contracts 定义消息和纯数据，server 负责可信宿主消息分发、桌面/CLI 与启动，preload 负责受限渲染进程接入。服务端可使用 Logic 的明确入口；契约与浏览器端不能加载 Node/Electron 或业务服务。业务数据类型归 Logic，Bridge 具名转接所需类型。

server/application.ts 只给 Logic Application 增加 dispatch，复用同一个构造和生命周期；IPC handlers 面向 ApplicationServices，不反向导入具体 Application。server/platform 处理 Electron utility 的私有传输，业务权限、Win32 操作与恢复仍归 Logic。

bootstrap 只加载验签后的固定业务入口与更新服务。构建仍输出 desktop.js、main.js、controlled-file-child.js 等原文件名；用户数据、R/E 缓存和升级清单格式没有改变。
