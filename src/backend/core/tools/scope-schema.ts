/**
 * 作用定位：工具回执与可信授权描述共用的纯范围协议，区分项目文件、知识、未知影响和外部仓库读取。
 * 设计原因：仓库读取与 GitHub 反馈有独立目标和连接代际，不能被记录成工作区文件证据；旧三类日志维持原字段形状。
 * 职责边界：范围只描述可信装配已绑定的目标，不携带地址、令牌或授权，也不从模型参数签发能力。
 */
import {z} from 'zod';
import {connectorIdSchema} from '../connectors/definition';
import {githubFeedbackScopeSchema} from '../../../logic/feedback';

const workspaceId=z.string();
export const repositoryToolScopeSchema=z.object({kind:z.literal('repository'),workspaceId,connectorId:connectorIdSchema,repositoryId:z.string().uuid(),connectionId:z.string().uuid(),operation:z.enum(['list','get'])}).strict();
// 兼容原工具日志出口，反馈范围唯一实现由 Logic 拥有。
export {githubFeedbackScopeSchema} from '../../../logic/feedback';
export const toolScopeSchema=z.union([
  z.object({kind:z.enum(['workspace','knowledge','unknown']),workspaceId}).strict(),repositoryToolScopeSchema,githubFeedbackScopeSchema,
]);
export type RepositoryToolScope=z.infer<typeof repositoryToolScopeSchema>;
export type ToolScope=z.infer<typeof toolScopeSchema>;
