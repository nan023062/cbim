# 能力

## 设计意图

聚合 CBIM 的虚拟角色与团队能力。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [Team](team.ts) | 组合子团队和岗位。 |
| [SkillScope](skills.ts) | 汇总岗位自身及上级团队声明的技能。 |
| [Organization](organization.ts) | 作为组织树根节点，查询团队与岗位、替换组织结构，并管理 Agent 实例。实例身份分配与引擎激活分开。 |

- [Agent](agent/ARCHITECTURE.md) 表达虚拟角色与运行配置。

主 Agent 与 Office 成员启动时均由调用方传入引擎工厂及其参数。Organization 预留实例身份，调用工厂取得已启动的引擎及其释放方法，启动成功后返回 Agent。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

```mermaid
classDiagram
class N_1e7eb579ff71["agent"] {
  <<virtual>>
}
click N_1e7eb579ff71 href "agent/ARCHITECTURE.md"
class N_2abf3b515e27["Organization"]
click N_2abf3b515e27 href "organization.ts"
class N_1aa95976a21f["Team"]
click N_1aa95976a21f href "team.ts"
class N_47d5ae9a1a34["SkillScope"]
click N_47d5ae9a1a34 href "skills.ts"
N_2abf3b515e27 ..> N_1aa95976a21f : 依赖
N_2abf3b515e27 ..> N_1e7eb579ff71 : 依赖
N_1e7eb579ff71 ..> N_1aa95976a21f : 依赖
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [agent](agent/ARCHITECTURE.md) | 冻结虚拟角色的身份、执行配置与对话，通过办公室读取任务环境。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
