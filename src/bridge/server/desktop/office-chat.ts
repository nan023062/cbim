/** 桌面 Office 对话的模型连接，凭据仅在 Electron 主进程解析。 */
import { readOfficeStream } from './office-stream';
import path from 'node:path';
import { systemSecretCipher } from '../../../core/io/electron';
import { LlmProfiles } from '../../../logic/models/service';
import { modelRequestUrl } from '../../../logic/models';
import type { OfficeChat } from '../../../logic-new/projects/offices';

export function desktopOfficeChat(root: string): OfficeChat
{
  const profiles = new LlmProfiles(path.join(root, 'llm.json'), systemSecretCipher);
  return async (instructions, messages, signal, progress) => {
    const start = Date.now();
    const { profile, apiKey } = await profiles.Resolve();
    progress({ phase: 'connecting', model: profile.model });
    const responses = profile.api === 'openai-responses';
    const anthropic = profile.api === 'anthropic-messages';
    const headers: Record<string,string> = { 'Content-Type': 'application/json' };
    if (anthropic) headers['anthropic-version'] = '2023-06-01';
    if (profile.auth === 'api-key') {
      if (anthropic) headers['x-api-key'] = apiKey;
      else headers.Authorization = 'Bearer ' + apiKey;
    }
    const payload = responses ? { instructions, input: messages } : anthropic ?
      { system: instructions, messages, max_tokens: Math.min(profile.maxTokens ?? 4096,4096) } :
      { messages: [{role:'system', content: instructions}, ...messages] };
    const res = await fetch(modelRequestUrl(profile.baseUrl, profile.api), {
      method: 'POST', redirect: 'error', headers, signal: AbortSignal.any([signal,AbortSignal.timeout(120000)]),
      body: JSON.stringify({ model: profile.model, ...payload, stream: true, ...(!responses && !anthropic ? {stream_options:{include_usage:true}} : {}) }),
    });
    if (!res.ok) throw Error('模型请求失败（HTTP ' + res.status + '）');
    const { reply, usage } = await readOfficeStream(res, profile.model, progress);
    const input = usage.input_tokens ?? usage.prompt_tokens;
    const output = usage.output_tokens ?? usage.completion_tokens;
    const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
    const written = usage.cache_creation_input_tokens ?? 0;
    const used = typeof input === 'number' ? input + (anthropic ? cached + written : 0) : undefined;
    const price = profile.pricing;
    const cost = used !== undefined && typeof output === 'number' && price ?
      ((used - cached - written) * price.input + cached * price.cacheRead + written * price.cacheWrite + output * price.output) / 1e6 : undefined;
    return { text: reply, metrics: { elapsed: Date.now()-start, model: profile.model, capacity: profile.contextWindow, used, output, cost } };
  };
}
