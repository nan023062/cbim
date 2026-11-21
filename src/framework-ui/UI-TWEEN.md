# ui-tween 使用手册

[框架入口](ui.css) 已加载[动效实现](ui-tween.css)。下面的属性可直接用于 JSX 或 HTML。先按触发方式选择：随布尔状态反复显示和隐藏，用双向过渡；元素刚出现时播放一次，用入场预设；悬停、展开或进度更新，用属性过渡。

## 桌面页面接入清单

按界面查现有实现。下表记录页面已接入的动效；完整预设及其参数见后续章节。

| 页面或控件 | 触发方式与动效 | 源码入口 |
| --- | --- | --- |
| Office 聊天记录 | 滚轮滚动时通过 `scrollbarVisible` 显示滚动条；向下滚动且未到底时，通过 `data-ui-fade` 显示「跳到底部」。两者双向过渡均为 200ms，停止滚动 3 秒后隐藏；到达底部时按钮立即开始淡出。 | [OfficeView](../view/office/OfficeView.tsx) · [WindowList](list.tsx) |
| Office 技能菜单 | 在输入框用 `/` 呼出可用技能清单，菜单使用 `popup` 入场，120ms。 | [SkillInput](../view/office/SkillInput.tsx) · [样式](../view/office/office.css) |
| 项目与对话列表 | 行背景色变化使用 `highlight`；悬停项目行或用键盘聚焦拖动手柄时，手柄使用 `opacity`。均为 120ms。 | [ProjectSidebar](../view/desktop/ProjectSidebar.tsx) · [样式](../view/desktop/desktop.css) |
| 对话签运行状态 | 运行时左侧图标使用 `pulse`（单程 1200ms），右侧圆环使用 `rotate`（每圈 1000ms）；有未读结果时改为静态绿点。 | [ProjectSidebar](../view/desktop/ProjectSidebar.tsx) · [样式](../view/desktop/desktop.css) |
| 侧栏菜单 | 打开项目或对话的操作菜单、任务筛选菜单、用户菜单时，使用 `popup` 入场，120ms。 | [ProjectSidebar](../view/desktop/ProjectSidebar.tsx) · [DesktopShell](../view/desktop/DesktopShell.tsx) · [样式](../view/desktop/desktop.css) |
| 引擎包管理页 | 已知百分比时，进度条宽度使用 `progress`，250ms；未知百分比时，使用 `sweep` 往返扫动，单程 1400ms。 | [EnginePackagesView](../view/discovery/EnginePackagesView.tsx) · [样式](../view/desktop/desktop.css) |
| 桌面通用按钮 | 按钮背景、边框或文字颜色变化时，默认使用 `control`，120ms；具体控件可覆盖该过渡。 | [共享按钮样式](../view/shared/interface.css) |

**未计入已接入页面的预设：** `panel`、`menu`、`turn` 在共享样式中有绑定，尚未确认具体页面上的触发点。`fade-in`、`fade-out`、`float`、`breathe`、`scale`、`pingpong` 暂未发现业务页面直接使用这些具名预设。

## 双向显示与隐藏

| 属性 | 触发方式 | 默认时长与参数 |
| --- | --- | --- |
| `data-ui-fade` | 元素保持挂载，将值从 `false` 改为 `true` 淡入，反向淡出。隐藏时阻止指针点击。 | 每个方向 200ms，`ease-in-out`；由 `--ui-motion-fade` 控制 |
| `data-ui-scrollbar-fade` | 在实际滚动容器上切换布尔值，滑块在透明色与 `--muted` 之间过渡；使用 `WindowList` 时传 `scrollbarVisible`。 | 同上；只改变滑块颜色，内容始终可见 |

```tsx
<button data-ui-fade={showJump} disabled={!showJump} onClick={jumpToBottom}>
  跳到底部
</button>
```

保持元素挂载才能看到淡出；隐藏可交互元素时，同步管理键盘焦点，如上例的 `disabled`。聊天窗的「静止 3 秒」是页面决定**何时**将状态设为 `false`，不计入 200ms 动画时长。

## 单次播放：挂载元素或切换到该预设时开始

写法：`<div data-motion="panel">…</div>`。页面重渲染但预设未变时，不会重新播放。

| `data-motion` | 效果 | 时长 / 缓动 |
| --- | --- | --- |
| `fade-in` | 不透明度从 0 到 1 | 240ms（`--ui-normal`）/ `--ui-ease-out` |
| `fade-out` | 淡至透明，保留结束状态；不会自动卸载或禁用元素 | 160ms（`--ui-fast`）/ `--ui-ease-in` |
| `scale` | 从 96% 放大至原尺寸 | 240ms（`--ui-normal`）/ `--ui-spring` |
| `panel` | 弹窗或面板从下方 12px 淡入 | 220ms（`--motion-panel`）/ `--motion-ease` |
| `menu` | 菜单从下方 3px 淡入 | 180ms（`--motion-normal`）/ `--motion-ease` |
| `popup` | 提示或快捷菜单从下方 3px 淡入 | 120ms（`--motion-fast`）/ `--motion-ease` |

## 属性过渡：目标样式变化时开始

将预设常驻在元素上，由页面提供起止值。仅添加预设不会自动改变颜色、角度、宽度或透明度。

| `data-motion` | 哪个变化会触发 | 时长 / 缓动 |
| --- | --- | --- |
| `control` | 悬停等状态改变背景色、边框色或文字色 | 120ms（`--motion-fast`）/ CSS 默认 `ease` |
| `highlight` | 选中或悬停引起背景色变化 | 120ms（`--motion-fast`）/ `--motion-ease` |
| `turn` | 展开或收起时改变 `transform`，例如箭头旋转 | 120ms（`--motion-fast`）/ `--motion-ease` |
| `opacity` | 改变 `opacity`，例如悬停时显示拖动手柄 | 120ms（`--motion-fast`）/ `--motion-ease` |
| `progress` | 两次进度更新之间改变 `width` | 250ms / `linear` |

```tsx
<div data-motion="progress" style={{ width: `${percent}%` }} />
```

## 循环播放：需要时添加，结束时移除

写法：`<span data-motion={busy ? 'rotate' : undefined}>…</span>`。下表为**单程**时长；往返效果一个完整周期为两倍时长。

| `data-motion` | 效果 | 单程时长 / 缓动 |
| --- | --- | --- |
| `float` | 向上浮动 4px 后返回 | 1000ms / `--ui-ease-in-out` |
| `rotate` | 连续同向旋转，每圈 360° | 1000ms / `linear` |
| `breathe` | 不透明度降至 0.45 后返回 | 1200ms / `--ui-ease-in-out` |
| `pulse` | 状态图标淡至 0.45 后返回 | 1200ms / CSS `ease-in-out` |
| `pingpong` | 在水平偏移 −3px 与 +3px 之间往返 | 800ms / `--ui-ease-in-out` |
| `sweep` | 不确定进度条水平移动自身宽度的 185% 后返回；由容器裁剪 | 1400ms / CSS `ease-in-out` |

## 参数与复用边界

- `data-motion` 一次匹配一个名字。需要外层面板入场、内层图标旋转时，分别把属性放到两层元素上。
- 无法直接给目标加属性时，样式表可使用同名预设：例如 `transition: var(--tween-turn)` 或 `animation: var(--tween-popup)`。可用的 `--tween-*` 为 `control`、`panel`、`menu`、`popup`、`turn`、`progress`、`sweep`、`highlight`、`opacity`、`pulse`。
- `--ui-motion-fade` 是「时长 + 缓动」的组合参数；`--ui-fast` 与 `--motion-fast` 是不同的时长，分别为 160ms 和 120ms。表中未列时长变量的效果采用固定时长。需要调整公共节奏时，在 `ui-tween.css` 更新预设并同步本表。
- 系统开启「减少动态效果」时，框架关闭动画和过渡，状态立即切换。提交、关闭或焦点恢复等逻辑不要依赖 `animationend` 或 `transitionend` 才完成。
