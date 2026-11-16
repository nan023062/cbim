# 产品静态资源

| 目录 | 用途 |
| --- | --- |
| branding | 前端、原生安装器与官网共用品牌源；原生资源单独打包 |
| business | Module 规范与当前 Schema |
| capability | Agent/Team 规范及 Schema |
| connector | 连接器声明规范与注册表 Schema |
| runtime | 内置 Skill、通用规则及方法结构规范 |
| task | 任务、基线、循环、基础抽象与架构评估的内置规范 |

运行资源包仅收集上述五个业务目录与 legal，不收集 design、docs 或 branding。Rules/Builtins 接收显式 assetsRoot；白名单 ID、只读约束与内容版本校验保持不变。产品目标、核心取舍、未落地设计与原型留在 design；工程记录与旧格式参考从 Git 历史追溯，不进入运行资源包；概念设计留在 docs。
