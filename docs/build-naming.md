# 构建命名

运行 `pnpm package` 或 `pnpm make` 时，使用该次构建开始时的北京时间（Asia/Shanghai）生成 `YYYYMMDD-HHmmss` 标识。同一次构建的打包、ZIP 与元数据使用同一标识。

默认输出结构：

```text
build/
  YYYYMMDD-HHmmss/
    CBIM Assistant-win32-x64/
      CBIM Assistant.exe
      ...其余运行文件
    make/zip/win32/x64/
      CBIM-Assistant-YYYYMMDD-HHmmss-win32-x64-0.1.0.zip
    build-info.json
  latest-build.json
```

按名称排序时间目录或 ZIP 即可按构建时间排列。EXE 在完整运行目录内保留固定名称，方便程序启动和测试，不单独改名或复制。

旧的功能命名构建目录保持原样，避免影响运行中的程序。后续默认不再按功能名称创建目录。

`CBIM_BUILD_OUT` 可覆盖输出目录；ZIP 仍带时间。`CBIM_BUILD_STAMP` 可显式复用某次构建标识，必须为上述格式；只在重用已有产物（如 `--skip-package`）时指定，并保持对应输出目录一致。

`latest-build.json` 记录最近成功的 package/make 阶段、输出位置、平台、架构、EXE 与分发文件列表。两个桌面验证脚本默认从它解析程序位置；设置 `CBIM_TEST_EXE` 时以指定路径为准。
