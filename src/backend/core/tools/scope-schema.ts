/**
 * 作用定位：工具回执与可信授权描述共用的纯范围协议，区分项目文件、知识、未知影响和外部仓库读取。
 * 设计原因：仓库资料有独立的目标与共享代际，不能因同属 read 被记录成工作区文件证据；旧三类日志维持原字段形状。
 * 职责边界：范围只描述可信装配已绑定的目标，不携带地址、令牌或授权，也不从模型参数签发能力。
 */
import {z} from 'zod';
import {connectorIdSchema} from '../connectors/definition';

const workspaceId=z.string();
export const repositoryToolScopeSchema=z.object({kind:z.literal('repository'),workspaceId,connectorId:connectorIdSchema,repositoryId:z.string().uuid(),connectionId:z.string().uuid(),operation:z.enum(['list','get'])}).strict();
export const toolScopeSchema=z.union([
  z.object({kind:z.enum(['workspace','knowledge','unknown']),workspaceId}).strict(),repositoryToolScopeSchema,
]);
export type RepositoryToolScope=z.infer<typeof repositoryToolScopeSchema>;
export type ToolScope=z.infer<typeof toolScopeSchema>;
