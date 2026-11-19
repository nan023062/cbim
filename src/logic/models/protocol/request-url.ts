import type { LlmApi } from './config';

/** 根据供应商协议拼接实际推理端点，保留厂商自定义路径前缀。 */
export function modelRequestUrl(baseUrl: string, api: LlmApi | 'openai-embeddings')
{
  const base = baseUrl.replace(/\/+$/, '');
  switch (api)
  {
    case 'openai-completions': return base + '/chat/completions';
    case 'openai-responses': return base + '/responses';
    case 'openai-embeddings': return base + '/embeddings';
    case 'anthropic-messages': return base + (base.endsWith('/v1') ? '/messages' : '/v1/messages');
  }
}
