> 2026-11-05 迁移说明：本文保留的 Python 命令属于历史实现，新助手不调用它们。现行运行入口为桌面应用与 `pnpm cli --root "<工程根>"`；迁移范围见工程 `docs/rule-migration.md`。

# Core 维护工具

本说明面向人，提供工具用途与文档导航。

## 一键预览整个项目的模块树

Windows 双击 [preview_modules.cmd](../preview_modules.cmd)，或运行：

```powershell
python -B design/scripts/preview_module_tree.py --root "<工程根>" --open
```

需要 Python 3.11 或更高版本，无第三方依赖；可从其他工作目录执行脚本，使用 --root 指定项目，省略时使用当前工作目录。省略 `--open` 仅生成预览。HTML、定义哈希与结果回执写入 `<用户主目录>/.cbim/<项目标识>/task-records/<时间>_module-tree/`，HTML 可单文件分享和离线打开，不需要服务器。每次运行重新读取模块定义。

默认展开全部正式模块，保持文字可读；“全图”查看整体分布，“可读大小”恢复原尺寸。支持搜索定位、拖动、缩放、折叠、查看职责和 source 范围，并可显示直属内容虚拟子模块。连线表示包含关系，业务依赖仍以模块正文类图为准。快照包含模块知识，分享前按项目权限处理。

## 维护与校验

- [注册表维护与校验规范](registry-maintenance.md)：操作步骤、摘要要求、失败恢复和测试命令。
- [模块源检查工具](check_module_sources.py)：检查重复声明；正常父子及祖先包含只记录、不报警，跨分支包含保留为工程结构存量警告，同模块冗余包含及层级方向相反仍提示复核。
- [注册表工具](maintain_registries.py)：检查定义、生成索引。
- [依赖检查工具](check_core_dependencies.py)：检查抽象层显式引用方向、目标存在性与执行文档的 README 依赖链。

工具只覆盖可自动判定的部分；知识语义和上下文加载是否合理还需复核。执行规范集中维护在上面的专用文件中。
