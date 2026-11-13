# src/logic/file-operations/platform/files 架构

## 目录定位

受控文件的 Win32 操作、子进程协议、冻结内容和产物读取验证；传输由 Bridge 注入，不能用取消代替物理退出。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [artifact-files.ts](artifact-files.ts) | 在固定工作区根内安全读取业务文件，供指纹采集、复核、无基线观察及冻结 JSON/CSV/PNG 验证共用。 |
| [code-check-runner.ts](code-check-runner.ts) | 在已打开的本地工作区执行冻结代码检查，复用完整目录枚举核实前后源码集合。 |
| [controlled-file-blobs.ts](controlled-file-blobs.ts) | 保存受控写入的私有 before/intended-after 字节，公开回执只引用 UUID 与哈希。 |
| [controlled-file-protocol.ts](controlled-file-protocol.ts) | Main 与专用文件 utility 子进程之间的严格私有消息及不透明会话端口。 |
| [controlled-file-win32.ts](controlled-file-win32.ts) | 专用 utility 子进程的同步 Win32 单文件实现；全程拥有文件及目录句柄。 |
| [output-manifest-files.ts](output-manifest-files.ts) | 在固定工作区内枚举声明范围的全部目录和普通文件，生成完整产物观察并按原集合复核。 |
| [png-validator.ts](png-validator.ts) | 安全文件端口后的有界静态 PNG 解码器，核全部块及压缩数据并还原实际像素。 |
| [scoped-execution-files.ts](scoped-execution-files.ts) | 正式成员冻结范围的实际 Win32 文件读取与 LPAC 执行端口。 |

## 架构类图

### artifact-files.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_artifact_files_ts["artifact-files.ts"] {
  <<module>>
  +normalizeArtifactPath()
}
```

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_artifact_files_ts["artifact-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_artifact_files_ts_ArtifactFiles["ArtifactFiles"] {
  +captureFiles()
  +observeFiles()
  +validateFile()
  +validateTable()
  +validateImage()
  +checkFiles()
  -root
  -assert
  -secureRead
  -resolve()
  -readFiles()
  -readFile()
}
N_src_logic_file_operations_platform_files_artifact_files_ts ..> N_src_logic_file_operations_platform_files_artifact_files_ts_ArtifactFiles : 声明
```

直接依赖：[../../../../core/errors.ts](../../../../core/errors.ts)、[../../../evidence/rules/artifact-baseline.ts](../../../evidence/rules/artifact-baseline.ts)、[../../../workspace/rules/json-validation-schema.ts](../../../workspace/rules/json-validation-schema.ts)、[../../../workspace/rules/csv-validation-schema.ts](../../../workspace/rules/csv-validation-schema.ts)、[../../../workspace/rules/png-validation-schema.ts](../../../workspace/rules/png-validation-schema.ts)、[png-validator.ts](png-validator.ts)、[../../../tasks/rules/effect-observation.ts](../../../tasks/rules/effect-observation.ts)。

### code-check-runner.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_code_check_runner_ts["code-check-runner.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_code_check_runner_ts_CodeCheckRunner["CodeCheckRunner"] {
  +run()
  -root
  -assertCurrent
  -manifests
  -directory()
  -command()
}
N_src_logic_file_operations_platform_files_code_check_runner_ts ..> N_src_logic_file_operations_platform_files_code_check_runner_ts_CodeCheckRunner : 声明
class N_src_logic_file_operations_platform_files_code_check_runner_ts_external_CodeCheckPort["CodeCheckPort (外部契约)"] {
  <<external>>
}
N_src_logic_file_operations_platform_files_code_check_runner_ts_external_CodeCheckPort <|.. N_src_logic_file_operations_platform_files_code_check_runner_ts_CodeCheckRunner
```

直接依赖：[../../../../core/platform/node/serialization.ts](../../../../core/platform/node/serialization.ts)、[../../../../core/errors.ts](../../../../core/errors.ts)、[../../../workspace/rules/code-check.ts](../../../workspace/rules/code-check.ts)、[../../../evidence/rules/code-check.ts](../../../evidence/rules/code-check.ts)、[../../../evidence/rules/output-manifest-evidence.ts](../../../evidence/rules/output-manifest-evidence.ts)、[output-manifest-files.ts](output-manifest-files.ts)。

### controlled-file-blobs.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_controlled_file_blobs_ts["controlled-file-blobs.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_blobs_ts_ControlledFileBlobs["ControlledFileBlobs"] {
  +savePair()
  +read()
  -directory
  -tail
  -checkedDirectory()
  -save()
}
N_src_logic_file_operations_platform_files_controlled_file_blobs_ts ..> N_src_logic_file_operations_platform_files_controlled_file_blobs_ts_ControlledFileBlobs : 声明
```

直接依赖：[../../../../core/errors.ts](../../../../core/errors.ts)、[../../rules/controlled-file-operation.ts](../../rules/controlled-file-operation.ts)、[../../rules/controlled-file-event.ts](../../rules/controlled-file-event.ts)。

### controlled-file-protocol.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts["controlled-file-protocol.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledNamespaceChange["ControlledNamespaceChange"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledNamespaceChange : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledChildRequest["ControlledChildRequest"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledChildRequest : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledFileIdentity["ControlledFileIdentity"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledFileIdentity : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledContentFact["ControlledContentFact"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledContentFact : 声明
```

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts["controlled-file-protocol.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledChildReply["ControlledChildReply"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledChildReply : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ExclusiveControlledFile["ExclusiveControlledFile"] {
  <<interface>>
  +readBefore()
  +recheckIdentity()
  +replaceAndFlush()
  +writeIssued
}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ExclusiveControlledFile : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ExclusiveControlledTransition["ExclusiveControlledTransition"] {
  <<interface>>
  +readBefore()
  +recheckIdentity()
  +transitionAndVerify()
  +writeIssued
}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ExclusiveControlledTransition : 声明
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledFileTransport["ControlledFileTransport"] {
  <<interface>>
  +withExclusiveExisting()
  +withExclusiveTransition()
  +drain()
  +close()
}
N_src_logic_file_operations_platform_files_controlled_file_protocol_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts_ControlledFileTransport : 声明
```


### controlled-file-win32.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts["controlled-file-win32.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts_Win32ControlledFile["Win32ControlledFile"] {
  +writeIssued
  +read()
  +replace()
  +transition()
  +close()
  -root
  -relativePath
  -namespaceChange
  -readOnly
  -directoryOnly
  -koffi
  -api
  -handles
  -file
  -applied
  -original
}
N_src_logic_file_operations_platform_files_controlled_file_win32_ts ..> N_src_logic_file_operations_platform_files_controlled_file_win32_ts_Win32ControlledFile : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts["controlled-file-win32.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts_Win32ControlledFile["Win32ControlledFile"] {
  -bool()
  -openHandle()
  -final()
  -info()
  -target()
  -lockParents()
  -missing()
  -open()
  -checkedIdentity()
  -defaultStreamOnly()
}
N_src_logic_file_operations_platform_files_controlled_file_win32_ts ..> N_src_logic_file_operations_platform_files_controlled_file_win32_ts_Win32ControlledFile : 声明
```

直接依赖：[controlled-file-protocol.ts](controlled-file-protocol.ts)。

### output-manifest-files.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_output_manifest_files_ts["output-manifest-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_output_manifest_files_ts_OutputManifestFiles["OutputManifestFiles"] {
  +capture()
  +check()
  -root
  -assert
  -guarded
  -files
  -current()
  -locate()
  -scan()
}
N_src_logic_file_operations_platform_files_output_manifest_files_ts ..> N_src_logic_file_operations_platform_files_output_manifest_files_ts_OutputManifestFiles : 声明
```

直接依赖：[../../../../core/errors.ts](../../../../core/errors.ts)、[../../../workspace/rules/artifact-scope.ts](../../../workspace/rules/artifact-scope.ts)、[../../../evidence/rules/output-manifest.ts](../../../evidence/rules/output-manifest.ts)、[../../../evidence/rules/output-manifest-evidence.ts](../../../evidence/rules/output-manifest-evidence.ts)、[artifact-files.ts](artifact-files.ts)。

### png-validator.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_png_validator_ts["png-validator.ts"] {
  <<module>>
  +decodePngRaster()
  +validatePngArtifact()
}
```

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_png_validator_ts["png-validator.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_png_validator_ts_Issue["Issue"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_png_validator_ts ..> N_src_logic_file_operations_platform_files_png_validator_ts_Issue : 声明
class N_src_logic_file_operations_platform_files_png_validator_ts_PngRasterResult["PngRasterResult"] {
  <<type>>

}
N_src_logic_file_operations_platform_files_png_validator_ts ..> N_src_logic_file_operations_platform_files_png_validator_ts_PngRasterResult : 声明
```

直接依赖：[../../../../core/errors.ts](../../../../core/errors.ts)、[../../../workspace/rules/png-validation-schema.ts](../../../workspace/rules/png-validation-schema.ts)。

### scoped-execution-files.ts

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_scoped_execution_files_ts["scoped-execution-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_scoped_execution_files_ts_ScopedExecutionFiles["ScopedExecutionFiles"] {
  +scope
  +snapshot()
  +lockDirectory()
  +read()
  +node()
  +drain()
  -root
  -assertCurrent
  -protectedRoots
  -lifecycle
  -unsettled
  -cleanupRetries
  -koffiPath
}
N_src_logic_file_operations_platform_files_scoped_execution_files_ts ..> N_src_logic_file_operations_platform_files_scoped_execution_files_ts_ScopedExecutionFiles : 声明
class N_src_logic_file_operations_platform_files_scoped_execution_files_ts_external_ScopedExecutionPort["ScopedExecutionPort (外部契约)"] {
  <<external>>
}
N_src_logic_file_operations_platform_files_scoped_execution_files_ts_external_ScopedExecutionPort <|.. N_src_logic_file_operations_platform_files_scoped_execution_files_ts_ScopedExecutionFiles
```

直接依赖：[../../../workspace/rules/execution-scope.ts](../../../workspace/rules/execution-scope.ts)、[../../rules/scoped-execution.ts](../../rules/scoped-execution.ts)、[../../../execution/rules/capabilities/run-scoped-execution.ts](../../../execution/rules/capabilities/run-scoped-execution.ts)、[controlled-file-win32.ts](controlled-file-win32.ts)、[../isolation/isolated-node.ts](../isolation/isolated-node.ts)、[../../../../core/errors.ts](../../../../core/errors.ts)、[../../rules/isolated-execution-recovery.ts](../../rules/isolated-execution-recovery.ts)、[../isolation/isolation-record.ts](../isolation/isolation-record.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_artifact_files_ts["artifact-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_png_validator_ts["png-validator.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_code_check_runner_ts["code-check-runner.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_output_manifest_files_ts["output-manifest-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts["controlled-file-win32.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_protocol_ts["controlled-file-protocol.ts"] {
  <<module>>
}
N_src_logic_file_operations_platform_files_artifact_files_ts ..> N_src_logic_file_operations_platform_files_png_validator_ts : 导入依赖
N_src_logic_file_operations_platform_files_code_check_runner_ts ..> N_src_logic_file_operations_platform_files_output_manifest_files_ts : 导入依赖
N_src_logic_file_operations_platform_files_controlled_file_win32_ts ..> N_src_logic_file_operations_platform_files_controlled_file_protocol_ts : 导入依赖
N_src_logic_file_operations_platform_files_output_manifest_files_ts ..> N_src_logic_file_operations_platform_files_artifact_files_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_logic_file_operations_platform_files_scoped_execution_files_ts["scoped-execution-files.ts"] {
  <<module>>
}
class N_src_logic_file_operations_platform_files_controlled_file_win32_ts["controlled-file-win32.ts"] {
  <<module>>
}
N_src_logic_file_operations_platform_files_scoped_execution_files_ts ..> N_src_logic_file_operations_platform_files_controlled_file_win32_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
