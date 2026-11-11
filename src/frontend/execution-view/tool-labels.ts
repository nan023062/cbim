/**
 * 作用定位：工具轨道和实时活动预览共用的公开动作名称。
 * 设计原因：将技术工具名翻译成正在发生的动作，只更改展示，不据名称推断执行成功或验收。
 */
const names:Record<string,string>={read:'读取文件',write:'写入文件',edit:'编辑文件',bash:'运行命令',ls:'查看目录',find:'查找文件',grep:'搜索内容',cbim_repository_list:'查询仓库资源',cbim_repository_get:'读取仓库资料',cbim_goal_inspect:'核实目标与分工',cbim_goal_plan:'保存目标计划',cbim_goal_review:'审阅目标与证据',cbim_dispatch_task:'派发成员任务',cbim_dispatch_inspect:'核实成员进展',cbim_task_plan:'保存执行计划',cbim_task_step:'更新执行步骤',cbim_delivery_prepare:'准备交付候选'};
/** 未识别的动作保留原名称，便于从展开的工作记录追溯。 */
export function toolLabel(name:unknown):string{return names[String(name)]??String(name||'工具操作')}
