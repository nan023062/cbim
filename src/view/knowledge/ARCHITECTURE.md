# src/view/knowledge 架构

<a id="contract"></a>

## 设计意图

提供静态知识编辑、文件预览与来源说明。表单和预览围绕明确基线组合，提交由业务服务裁决；业务模块图由 workspace 页面负责。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ArchitectureEditor](ArchitectureEditor.tsx) | 团队与业务架构共用的语义对象编辑器，负责表单、删除影响预览和显式事务提交。 |
| [KnowledgeFileTree](KnowledgeFileTree.tsx) | 业务/团队共用的可展开知识目录与文件导航。 |
| [KnowledgeFilePreview](KnowledgeFilePreview.tsx) | 在业务和团队架构中预览实际知识文件，并通过原知识事务编辑。 |
| [KnowledgeSourceDetails](KnowledgeSourceDetails.tsx) | 为项目岗位和模块责任共用展示来源身份、未决状态与明确采纳预览。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_4d92e86a944d["ArchitectureEditor"] {
  <<component>>
}
click N_4d92e86a944d href "ArchitectureEditor.tsx"
class N_72eb806cad44["KnowledgeFileTree"] {
  <<component>>
}
click N_72eb806cad44 href "KnowledgeFileTree.tsx"
class N_cdbae339190a["KnowledgeFilePreview"] {
  <<component>>
}
click N_cdbae339190a href "KnowledgeFilePreview.tsx"
class N_9c1056ee3aff["KnowledgeSourceDetails"] {
  <<component>>
}
click N_9c1056ee3aff href "KnowledgeSourceDetails.tsx"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
