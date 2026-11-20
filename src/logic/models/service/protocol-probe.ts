import { modelRequestUrl, parseModelCatalog, type LlmDefinition, type ResolvedLlm, type ResolvedModelOperation } from '../index';

function headers(api: string, auth: string, key: string)
{
  const h: Record<string, string> = { 'Content-Type': 'application/json' };

  if (api === 'anthropic-messages')
  {
    h['anthropic-version'] = '2023-06-01';

    if (auth === 'api-key')
      h['x-api-key'] = key
  }
  else if (auth === 'api-key')
    h.Authorization = 'Bearer ' + key;

  return h
}

/** 显式探测的诊断只保留 origin/path；不返回查询参数、服务器正文、请求头或密钥。 */
async function request(url: string, init: RequestInit)
{
  const endpoint = new URL(url);

  endpoint.username = '';

  endpoint.password = '';

  endpoint.search = '';

  endpoint.hash = '';

  let response: Response;

  try
  {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  catch
  {
    throw new Error(`模型端点 ${endpoint.href} 连接失败或超时，请检查网络与接口配置`);
  }

  if (!response.ok)
  {
    await response.body?.cancel();

    const reason = response.status === 401 ? '鉴权失败，请重新保存该供应商的 API Key' : response.status === 403 ? '访问被拒绝，请检查密钥权限与供应商访问限制' : response.status === 404 ? '端点或模型不存在，请核对接口协议、地址和模型 ID' : response.status === 429 ? '请求受限，请检查额度或稍后重试' : '请检查供应商服务与接口配置';

    throw new Error(`模型端点 ${endpoint.href} 返回 HTTP ${response.status}：${reason}`);
  }

  const reader = response.body?.getReader();

  let text = '';

  if (reader)
  {
    const decoder = new TextDecoder();

    while (true)
    {
      const part = await reader.read();

      if (part.done)
        break;

      text += decoder.decode(part.value, { stream: true });

      if (text.length > 1024 * 1024)
      {
        await reader.cancel();

        throw new Error('模型响应过大')
      }
    }

    text += decoder.decode()
  }

  return JSON.parse(text);
}

export async function discoverProtocolModels(connection: Pick<LlmDefinition, 'api' | 'auth' | 'baseUrl'>, key: string)
{
  const base = connection.baseUrl.replace(/\/$/, ''),
    anthropic = connection.api === 'anthropic-messages';

  const url = base + (anthropic && !base.endsWith('/v1') ? '/v1/models' : '/models');

  const body = await request(url, { headers: headers(connection.api, connection.auth, key) });

  if (!Array.isArray(body.data))
    throw new Error('接口未返回模型列表，请手动添加模型');

  return parseModelCatalog(body.data);
}

export async function probeGeneration({ profile: p, apiKey }: ResolvedLlm)
{
  const started = Date.now(),
    anthropic = p.api === 'anthropic-messages',
    responses = p.api === 'openai-responses';

  const url = modelRequestUrl(p.baseUrl, p.api);

  const payload = responses ? { model: p.model, max_output_tokens: 64, stream: false, input: 'Reply with OK.' } : { model: p.model, max_tokens: 64, stream: false, messages: [{ role: 'user', content: 'Reply with OK.' }] };

  const body = await request(url, { method: 'POST', headers: headers(p.api, p.auth, apiKey), body: JSON.stringify(payload) });

  const valid = anthropic ? body.content?.some((x: any) => x.type === 'text' && typeof x.text === 'string') : responses ? body.output?.some((x: any) => x.type === 'message' && x.content?.some((c: any) => c.type === 'output_text' && typeof c.text === 'string')) : typeof body.choices?.[0]?.message?.content === 'string';

  if (!valid)
    throw new Error('接口没有返回有效文本，请核对接口协议');

  return { ok: true, model: p.model, latencyMs: Date.now() - started, api: p.api, baseUrl: p.baseUrl };
}

export async function probeEmbedding(operation: ResolvedModelOperation)
{
  const p = operation.profile;

  if (!('kind' in p) || p.kind !== 'embedding')
    throw new Error('所选模型没有向量能力');

  const started = Date.now(),
    body = await request(modelRequestUrl(p.baseUrl, 'openai-embeddings'), { method: 'POST', headers: headers(p.api, p.auth, operation.apiKey), body: JSON.stringify({ model: p.model, input: ['connection test'], encoding_format: 'float' }) });

  const vector = body.data?.[0]?.embedding;

  if (!Array.isArray(body.data) || body.data.length !== 1 || body.data[0].index !== 0 || !Array.isArray(vector) || vector.length !== p.dimensions || vector.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error('接口未返回配置维度的有效向量，请核对模型与维度');

  return { ok: true, model: p.model, latencyMs: Date.now() - started, api: p.api, baseUrl: p.baseUrl, dimensions: p.dimensions };
}
