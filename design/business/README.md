# Business：业务侧

本说明面向人。Module 表达工作对象的职责、边界、契约、知识与操作流程，可以覆盖程序、美术、策划、测试等业务，不等同于源代码目录。

- [Module 定义与维护规范](module-spec.md)：模块树、压缩索引、单文件知识、操作流程与迁移约束。
- [Module Schema](module.schema.json)：结构化字段校验。
- [BaseModule 类图](base-module.md)：面向人的关系展示。

逻辑模块与物理工作区分开表达，具体业务实例在项目扩展层维护。

模块目标布局：同级的 `module.json`（压缩索引）、`module.md`（完整五节知识），以及 `workflows/<工作流名>/workflow.md`（每个流程独立成目录，与 Agent Skill 对偶）。实例迁移须保全知识并同步引用；是否完成以新版严格校验与内容复核为准。
