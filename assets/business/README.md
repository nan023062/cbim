# 业务模块运行资源

- module-spec.md：产品内置模块维护规范，内置 ID 为 module-spec。
- module.schema.json：Rules 加载的模块结构校验，内置 ID 为 module-schema。

由资源包收集器随 assets/business 打包，由宿主注入 assets 根；不复制到用户工程。概念分工见 [产品模型](../../design/product-model.md)；仅供手工识别历史格式的 [历史 Schema](https://github.com/nan023062/cbim/blob/8c06ff1edacbb296efb994e80eb941a811a1aa8c/design/business/module.legacy.schema.json) 不属于当前运行校验或资源包。
