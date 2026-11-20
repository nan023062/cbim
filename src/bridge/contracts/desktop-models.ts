/** 新桌面模型设置的公开字段、请求校验与连接预览。 */
import { z } from 'zod';

import { connectionSchema, definition, llmApiSchema, type LlmSettings, type LlmApi, type DiscoveredModel } from '../../logic-new/settings/models';

export * from '../../logic-new/settings/models';

const identity = z.object({ id: z.string().uuid() }).strict();

const discovery = z.object({ id: z.string().uuid().optional(), connection: connectionSchema.strict(), apiKey: z.string().max(16000).optional() }).strict();

/** 仅现有公开字段；列表请求不接地址、命令或凭据。 */
export const modelActionSchemas = { 'models.list': z.object({}).strict().optional(), 'models.save': z.object({ id: z.string().uuid().optional(), profile: definition, apiKey: z.string().max(16000).optional() }).strict(), 'models.select': identity, 'models.remove': identity, 'models.testConnection': z.discriminatedUnion('kind', [identity.extend({ kind: z.literal('generation'), modelId: z.string().min(1).max(160), api: llmApiSchema }).strict(), identity.extend({ kind: z.literal('embedding'), modelId: z.string().min(1).max(160) }).strict(),]), 'models.discoverDetails': discovery, } as const;

export type ModelAction = keyof typeof modelActionSchemas;

export type ModelActionInput<K extends ModelAction> = z.infer<(typeof modelActionSchemas)[K]>;

export interface ModelActionResults
{
  'models.list': LlmSettings;

  'models.save': LlmSettings;

  'models.select': LlmSettings;

  'models.remove': LlmSettings;

  'models.testConnection':
  {
    ok: boolean;

    model: string;

    latencyMs: number;

    api: LlmApi | 'openai-embeddings';

    baseUrl: string;

    dimensions?: number
  };

  'models.discoverDetails': DiscoveredModel[];
}
