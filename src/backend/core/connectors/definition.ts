/**
 * 作用定位：链接器静态定义的纯协议，供知识校验、桌面连接管理与注册查询共用。
 * 设计原因：旧插件映射与资源仓库身份是两种不同来源，严格分支避免把声明误当运行授权或把地址、密钥写进可复用知识。
 * 职责边界：定义只标识链接目标；不访问网络、不打开共享服务，也不授予工作区读取权限。
 */
import {z} from 'zod';

/** 保留现有单叶知识标识格式；不接受目录穿越、URL 或嵌套链接器路径。 */
export const connectorIdSchema=z.string().regex(/^\.cbim\/connectors\/[A-Za-z0-9_-]+$/);
const fields={id:connectorIdSchema,name:z.string().min(1),summary:z.string().min(1)};

/** 旧格式故意没有 provider 字段；存在映射不证明宿主插件已连接。 */
export const pluginConnectorDefinitionSchema=z.object({
  ...fields,plugin:z.object({ghost_id:z.string().min(1),namespace:z.string().min(1).nullable()}).strict(),
}).strict();

/** 仓库身份与本机连接、账户及只读授权分离，禁止在静态定义保存 URL 或令牌。 */
export const resourceRepositoryConnectorDefinitionSchema=z.object({
  ...fields,provider:z.literal('resource_repository_v1'),repository:z.object({repositoryId:z.string().uuid()}).strict(),
}).strict();

export const connectorDefinitionSchema=z.union([pluginConnectorDefinitionSchema,resourceRepositoryConnectorDefinitionSchema]);
export const connectorRegistrySchema=z.object({connectors:z.array(connectorDefinitionSchema)}).strict();
export type PluginConnectorDefinition=z.infer<typeof pluginConnectorDefinitionSchema>;
export type ResourceRepositoryConnectorDefinition=z.infer<typeof resourceRepositoryConnectorDefinitionSchema>;
export type ConnectorDefinition=z.infer<typeof connectorDefinitionSchema>;

/** 只区分已通过协议校验的静态分支；不是能力发现或授权判定。 */
export function isResourceRepositoryConnector(definition:ConnectorDefinition):definition is ResourceRepositoryConnectorDefinition{
  return 'provider' in definition&&definition.provider==='resource_repository_v1';
}
