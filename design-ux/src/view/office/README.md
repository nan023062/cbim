# 业务与组织架构

正式客户端支持在「编辑团队」中维护独立技能，并在「编辑业务节点」中维护产出物与逐行交付标准。两者通过项目版本化架构服务写入项目目录。工作流详情展示正文引用，可复制定位；页面不会按任意路径读取文件。复验命令 `node design-ux/review/architecture-disk-check.cjs` 使用新建的临时目录写入、重新打开并核对数据。

[业务入口](architecture-preview.html#business) · [组织入口](architecture-preview.html#organization) · [业务预览](business-architecture-preview.png) · [组织预览](organization-architecture-preview.png)

业务树对应 [BusinessPanel](../../../../src/view/office/BusinessPanel.tsx)。选择资源商城查看职责、来源和子工作区，进入业务负责人可查看对应岗位并返回。各层业务节点可独立配置工作流步骤、负责团队或岗位、产出物及逐条交付标准。

组织树对应 [OrganizationPanel](../../../../src/view/office/OrganizationPanel.tsx)。团队和岗位均有独立的专属技能列表。技能按名称、稳定 ID 和内容保存。查看内容、修改后保存或取消均留在原节点。团队技能属于交互提案；示例配置只写本浏览器本地存储，无任务派发。

用浏览器打开 HTML 即可离线试用。验证示例：在资源团队添加一项技能，切换资源维护岗，再返回团队并刷新复查。业务页可在资源目录添加交付标准，核对资源商城原有工作流。源码侧相关测试包括[组织目录](../../../../tests/src/logic/projects/organization-directory.test.ts)与[业务架构](../../../../tests/src/logic/projects/architecture-live.test.ts)。
