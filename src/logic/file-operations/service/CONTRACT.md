# 受控文件的服务关闭边界

ControlledFiles 的 operations 组合 utility.InFlightOperations，只跟踪原操作 Promise；controllers、closed、heldReleases 仍由服务维护。关闭先拒绝新业务并撤销原控制器，再等待当前操作集合、核实平台 transport.drain，最后释放原租约。排空失败不跳过平台核实或释放屏障。

对象身份、字节备份、阶段账本、一次授权、补偿预览与显式提交保留在本目录及 Core 原契约中。基础集合不发起文件操作，不创建重试/恢复或全局共享状态。
