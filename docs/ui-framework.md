# UI 框架：图标与交互控件使用手册

给编写桌面页面的开发者：控件位于 `src/framework-ui/`，按文件具名导入，没有统一的包入口。下面的相对导入以 `src/view/desktop/` 下的页面为例。控件处理焦点、键盘和显示；当前选项、未读状态、提交和错误处理由页面持有。

## 快速接入：一行可打开、可预览的对话

```tsx
import { Button, ListItem } from '../../framework-ui/controls';
import { Icon } from '../../framework-ui/Icon';

function ConversationRow({ title, unread, open, preview, more }: {
  title: string; unread: boolean; open(): void; preview(): void; more(): void;
}) {
  return <div>
    <ListItem onClick={open} onMouseEnter={preview} onFocus={preview}
      onContextMenu={event => { event.preventDefault(); more(); }}>
      <Icon name="chat" />{title}
      {unread && <Icon name="dot" size={9} tone="success" label="有未读结果" />}
    </ListItem>
    <Button aria-label={`更多操作：${title}`} onClick={more}><Icon name="more" /></Button>
  </div>;
}
```

`ListItem` 本身就是按钮，所以「更多」放在它旁边。鼠标悬停与键盘聚焦是两个不同事件；如果预览在鼠标移开时关闭，也应考虑 `onBlur`。右键菜单的同一操作应有可聚焦的入口。

## Icon：选图、着色、动效和命名

| Prop | 类型 / 默认值 | 用途 |
| --- | --- | --- |
| `name` | `string`，必填 | 图形名或别名；未知名称显示 `info`。应用代码可用导出的 `IconName` 约束配置。 |
| `size` | `number`，默认 `18` | SVG 的宽和高，单位为 px。 |
| `tone` | `success`、`danger`、`warning`，可省略 | 以主题色表达状态；省略时使用当前文字颜色。 |
| `motion` | `rotate`、`pulse`，可省略 | 连续旋转或呼吸，遵循系统减少动态效果偏好。 |
| `label` | `string`，可省略 | 独立状态图标的无障碍名称。装饰图标省略；纯图标按钮在按钮上给 `aria-label`。 |

| 场景 | 常用名称与组合 |
| --- | --- |
| 未读、运行、警告 | `dot` + `tone="success"`；`spinner` + `motion="rotate"`；`warning` + `tone="warning"`。静态空心圆用 `circle`。 |
| 更多、右键、对话 | `more`、`rightClick`、`conversation`（别名 `chat`）。`rightClick` 只绘图，右键事件绑定在控件上。 |
| 常用操作 | `archive`、`copy`、`refresh`、`download`、`settings`。 |

完整名称从 [Icon.tsx](../src/framework-ui/Icon.tsx) 导出的 `iconNames` 获取，包含别名。需要图标选择器时可直接遍历，无需维护第二份清单：

```tsx
import { Icon, iconNames, type IconName } from '../../framework-ui/Icon';
const warningIcon: IconName = 'warning';
const swatches = iconNames.map(name => <span key={name}><Icon name={name} /> {name}</span>);
```

## Button、ListItem、Toggle：原生事件与受控状态

| 控件 | Props 与事件 |
| --- | --- |
| `Button` | 接受原生按钮属性，包括 `children`、`className`、`disabled`、`type` 和 `aria-*`。默认 `type="button"`，提交表单要显式设置 `type="submit"`。 |
| `ListItem` | 与 `Button` 相同的属性和事件，布局适合图标加文字。选中态由调用方传入，例如当前导航项的 `aria-current="page"`。 |
| `Toggle` | `checked: boolean` 和 `onChange(next: boolean)` 必填，其他属性沿用按钮（不另传 `onClick`）。点击或键盘激活会请求反转状态，需要页面更新 `checked`。 |

`Button` 和 `ListItem` 可直接绑定 `onClick`、`onDoubleClick`、`onMouseEnter/Leave`、`onFocus/Blur`、`onKeyDown`、`onContextMenu` 及指针事件。原生按钮支持 Enter 和空格激活，同一操作不必在 `onKeyDown` 再执行一次。

```tsx
const [enabled, setEnabled] = useState(false);
// 在组件的 JSX 中：
<Toggle checked={enabled} onChange={setEnabled}>显示预览</Toggle>
```

## StateButton：同一个按钮支持多种动作

从 `controls.tsx` 导入。`state` 为当前状态名，`states` 按状态名提供配置，每项必须有无障碍名称 `label`，可传 `children`、`title`、`type`、`disabled`、`onClick`。页面负责切换状态；框架保留同一个按钮和焦点。默认 `type="button"`，表单提交态显式指定 `submit`。

```tsx
<StateButton state={running ? "stop" : "send"} states={{
  send: { label: "发送", type: "submit", children: <Icon name="sendSolid" /> },
  stop: { label: "停止", onClick: stop, children: <Icon name="stopSolid" /> },
}} />
```

## Tabs：受控页签

`label` 为页签组的无障碍名称；`items` 每项包含唯一 `id`、`label: ReactNode`、`content: ReactNode`，以及可选 `buttonProps`。`value` 是选中项 ID；`onChange(id)` 请求切换，由调用方更新 `value`。

```tsx
const [tab, setTab] = useState('chat');
return <Tabs label="工作区视图" value={tab} onChange={setTab} items={[
  { id: 'chat', label: <><Icon name="chat" /> 对话</>, content: <Chat /> },
  { id: 'history', label: '历史', content: <History />, buttonProps: { title: '查看历史' } },
]} />;
```

从 `tabs.tsx` 导入 `Tabs`。左右方向键循环切换，Home / End 定位首尾。单项 `buttonProps` 可加悬停、焦点或点击回调；自定义 `onClick` / `onKeyDown` 先运行，调用 `preventDefault()` 会阻止该次框架切换。不通过 `buttonProps` 设置 `disabled`、`role`、`id` 或 `tabIndex`。

## ConfirmWindow：确认后再执行业务操作

从 `windows/ConfirmWindow.tsx` 导入。挂载时打开模态窗，卸载时关闭；不接受 `open` 属性。`title`、`children`、`onConfirm()`、`onCancel()` 必填。取消按钮和 Esc 都调用 `onCancel`；`onConfirm` 不自动关闭弹窗。

| 可选 Prop | 默认 / 行为 |
| --- | --- |
| `confirmLabel`、`cancelLabel`、`busyLabel` | 默认「确认」「取消」「正在处理…」。 |
| `danger`、`focusConfirm` | 默认均为 `false`。前者将确认按钮标红；后者将初始焦点从取消移到确认，二者独立。 |
| `busy`、`error` | 提交中传 `busy` 以禁用两个按钮和 Esc；失败时保持挂载并传入错误字符串。 |

```tsx
{showConfirm && <ConfirmWindow title="归档对话" confirmLabel="确认归档" busyLabel="正在归档…"
  danger focusConfirm busy={saving} error={error} onCancel={() => setShowConfirm(false)}
  onConfirm={submitArchive}>归档「{title}」？可在已归档列表中恢复。</ConfirmWindow>}
```

`submitArchive` 由页面实现：开始时设置 `saving`，成功后关闭，失败后显示 `error` 并解除忙碌状态。

## 长列表、页面生命周期和三栏布局

| API | Props、事件与使用时机 |
| --- | --- |
| [`WindowList`](../src/framework-ui/list.tsx) | 长列表必传 `count`、`itemKey(index)`、`render(index)`、`label`。键使用稳定记录 ID。`initialEnd` 初始定位末尾并支持跟随；`scrollbarVisible` 控制滑块显隐；`onStart()` 到达开头时可加载更早记录。`firstIndex` 默认 0；条目回调取得相对索引。 |
| `ListHandle` | `listRef` 接收句柄；`ref.current?.scrollToEnd()` 归底，`scrollToRow(index)` 跳到指定行。后者把索引直接传给虚拟列表，使用非零 `firstIndex` 时注意索引口径。 |
| [`Screen`、`useScreenEffect`](../src/framework-ui/screen.tsx) | `Screen` 支持原生 section 属性和 `active`（默认 `true`）。隐藏不会卸载子树；`useScreenEffect(effect, deps)` 用于只在页面可见时订阅的事件，隐藏或卸载时执行 effect 返回的清理函数。 |
| [`ThreePaneLayout`](../src/framework-ui/three-pane.tsx) | 传 `children`、`className`、`leftOpen`、`leftKey`、`rightKey`，可选 `hidden`。两个 key 分别保存左右宽度；业务布局消费 `--sidebar-width` 和 `--right-pane-width`，并负责展开或隐藏面板。 |
| `PaneDivider` | 在布局内部对应面板上放置，传 `side="left"` 或 `"right"`、无障碍 `label`、目标面板 ID `controls`。支持指针拖拽、左右键每次移动 10px、Home 或双击复位。 |

实际页面可参照[侧栏列表与确认窗](../src/view/desktop/ProjectSidebar.tsx)、[三栏布局](../src/view/desktop/DesktopShell.tsx)和[聊天虚拟列表](../src/view/office/OfficeView.tsx)。淡入淡出、悬停与循环动效的触发方式和时长见 [ui-tween 手册](UI-TWEEN.md)。
