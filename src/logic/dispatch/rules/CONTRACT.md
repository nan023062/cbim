# 团队逻辑对话登记

`DispatchState.teamSessions` 和 `DispatchMutation.teamSessions` 保存办公室内的长期对话身份。与主根、成员登记和任务派发共用原子提交；独立控制面已有的严格 mutation 白名单不放宽。旧状态缺省保持缺省，关闭周期不删除登记；消息正文、原生路径和执行授权不进入此表。
