/**
 * 作用定位：向桌面公开工作区资源仓库链接器的登记、授权和真实 HTTP 核验协议。
 * 设计原因：复用 Core 的安全 DTO，界面不接触共享令牌、服务地址、文件路径或运行服务；知识定义与授权使用不同回执。
 */
export type {
  RepositoryConnectionList,RepositoryConnectionPreview,RepositoryConnectionCommit,
  RepositoryConnectionGrantInput,RepositoryConnectionRevokeInput,RepositoryConnectionReceipt,RepositoryConnectionCheck,
  RepositoryConnectionCommitInput,RepositoryConnectionLookup,RepositoryConnectionCommitLookup,
  RepositoryConnectionUnacceptedInput,RepositoryConnectionUnaccepted,
} from '../../backend/core/connectors/repository-connection';
export {
  repositoryConnectionCommitInputSchema,repositoryConnectionCommitSchema,repositoryConnectionCommitLookupSchema,
  repositoryConnectionGrantInputSchema,repositoryConnectionRevokeInputSchema,repositoryConnectionGrantSchema,
  repositoryConnectionReceiptSchema,repositoryConnectionLookupSchema,
  repositoryConnectionUnacceptedInputSchema,repositoryConnectionUnacceptedSchema,
} from '../../backend/core/connectors/repository-connection';
