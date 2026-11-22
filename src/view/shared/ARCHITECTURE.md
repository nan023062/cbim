# 共享表现组件

## 设计意图

Icon 的组织操作图形包含返回、新增团队和新增成员，复用既有线性图标风格；文字提示和可访问名称由使用它的按钮提供。

承载跨界面的图标、品牌及基础样式。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [品牌标记](BrandMark.tsx) | 展示应用品牌标记。 |


<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_c1b9d82de9cb["品牌标记"] {
  <<component>>
}
click N_c1b9d82de9cb href "BrandMark.tsx"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->


### Office 指令排队

共享 Icon 增加 up/down，配合 grip、enqueue、edit、remove、pause/play 表示队列排序、插入和控制；按钮保留 title 与可访问名称。


### 项目与对话导航

项目侧栏补充 pin、archive、chevronDown/chevronRight 线性图标；动作按钮保留可访问名称及提示，鼠标悬停和键盘聚焦显示快捷入口，触屏常显。
