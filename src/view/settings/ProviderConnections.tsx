/**
 * 作用定位：供应商表单的接口预设、自动识别和高级兼容地址编辑，以及已保存配置的按操作/接口连接测试。
 * 设计原因：一份凭据对应多个明确接口，编辑草稿与测试已保存配置分开；页面展示推导地址，不自动联网或写回。
 * 职责边界：测试只验证短文本响应，是否支持工具、推理及流式由实际执行和供应商能力决定。
 */
import { Button, Checkbox, Disclosure, DisclosureSummary, FieldLabel, Input, Option, Select } from '../../framework-ui';
import { useState } from 'react';

import { selectProviderConnection, type LlmApi, identifyProvider, llmApiSchema, providerPresets, type LlmDefinition, type LlmProfile } from '../../bridge/contracts/desktop-models';

import type { ModelActionResults } from '../../bridge/contracts/desktop-models';

const labels = { 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages', 'openai-embeddings': 'OpenAI Embeddings' };

/** 父表单持有草稿及凭据；选择预设只修改公开配置，取消仍由父表单丢弃。 */
export function ProviderConnections({ value, onChange }: { value: LlmDefinition; onChange: (value: LlmDefinition) => void })
{
  const detected = identifyProvider(value.baseUrl);

  const preset = value.autoDetect === false ? '' : detected?.id ?? '';

  return <>
    <FieldLabel>供应商预设<Select aria-label="供应商预设" value={preset} onChange={event => { const next = providerPresets.find(item => item.id === event.target.value); if (!next) { onChange({ ...value, autoDetect: false }); return } const connection = next.connections[0]; onChange({ ...value, name: value.name || next.name, api: connection.api, baseUrl: connection.baseUrl, autoDetect: true, alternateConnections: undefined }); }}><Option value="">自定义供应商</Option>{providerPresets.map(item => <Option key={item.id} value={item.id}>{item.name}</Option>)}</Select></FieldLabel>
    <FieldLabel>接口协议<Select aria-label="接口协议" value={value.api} onChange={event => { const api = llmApiSchema.parse(event.target.value); onChange({ ...value, api, alternateConnections: value.alternateConnections?.filter(item => item.api !== api) }); }}>{llmApiSchema.options.map(api => <Option key={api} value={api}>{labels[api]}</Option>)}</Select></FieldLabel>
    <FieldLabel>API 地址<Input required type="url" value={value.baseUrl} onChange={event => onChange({ ...value, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></FieldLabel>
    <p className="inline-note">填写接口根地址，不包含 /chat/completions、/responses 或 /messages。仅支持 HTTPS 或本机 HTTP。</p>
    <FieldLabel><Checkbox checked={value.autoDetect !== false} onChange={event => onChange({ ...value, autoDetect: event.target.checked })} />按官方地址识别兼容接口，共用此供应商的 API Key</FieldLabel>
    <p className="inline-note">{detected && value.autoDetect !== false ? `已识别 ${detected.name}，可使用对应的兼容接口。` : '当前未匹配官方预设，仅使用明确配置的接口。'}不会转换模型 ID；地区、套餐和第三方网关按各自地址配置。</p>
    <Disclosure><DisclosureSummary>高级：自定义兼容接口</DisclosureSummary>
      <p className="inline-note">用于供应商支持多种协议但未被自动识别的情况。所有接口共用本供应商的 Key；新增或修改兼容地址后需重新输入 Key。保存后可逐接口测试。</p>
      {(value.alternateConnections ?? []).map((connection, index) => <div key={connection.api} className="model-row">
        <FieldLabel>{labels[connection.api]} 地址<Input required type="url" value={connection.baseUrl} onChange={event => onChange({ ...value, alternateConnections: value.alternateConnections!.map((item, i) => i === index ? { ...item, baseUrl: event.target.value } : item) })} /></FieldLabel>
        <FieldLabel><Checkbox checked={!!connection.modelIds} disabled={!value.models.length} onChange={event => onChange({ ...value, alternateConnections: value.alternateConnections!.map((item, i) => i === index ? { ...item, modelIds: event.target.checked ? [value.defaultModel || value.models[0].id] : undefined } : item) })} />仅允许指定型号（不勾选时共用全部型号）</FieldLabel>
        {connection.modelIds && <div className="model-actions">{value.models.map(model => <FieldLabel key={model.id}><Checkbox checked={connection.modelIds!.includes(model.id)} onChange={event => { const modelIds = event.target.checked ? [...connection.modelIds!, model.id] : connection.modelIds!.filter(id => id !== model.id); onChange({ ...value, alternateConnections: value.alternateConnections!.map((item, i) => i === index ? { ...item, modelIds } : item) }); }} />{model.name || model.id}</FieldLabel>)}</div>}
        <Button type="button" onClick={() => onChange({ ...value, alternateConnections: value.alternateConnections!.filter((_, i) => i !== index) })}>移除 {labels[connection.api]} 接口</Button>
      </div>)}
      <div className="model-actions">{llmApiSchema.options.filter(api => api !== value.api && !value.alternateConnections?.some(item => item.api === api)).map(api => <Button key={api} type="button" onClick={() => onChange({ ...value, alternateConnections: [...(value.alternateConnections ?? []), { api, baseUrl: '' }] })}>添加 {labels[api]} 接口</Button>)}</div>
    </Disclosure>
    <p className="inline-note">保存前的接口预览（默认模型）：</p>
    {llmApiSchema.options.map(api => { const connection = selectProviderConnection(value, { supportedApis: [api], fallbackApi: api }, value.defaultModel || undefined); return <p key={api} className="inline-note">{labels[api]}：{connection?.baseUrl ? `${labels[connection.api]} · ${connection.baseUrl}（${connection.source === 'primary' ? '主接口' : connection.source === 'explicit' ? '自定义' : '官方预设'}）` : '没有适用于当前默认模型的接口'}</p>; })}
  </>;
}

/** 测试已保存模型的明确操作与接口；选菜单不发请求，不依赖执行引擎。 */
export function ProviderConnectionTest({ profile, busy, onTest }: { profile: LlmProfile; busy: boolean; onTest: (operation: ({ kind: 'generation'; modelId: string; api: LlmApi } | { kind: 'embedding'; modelId: string })) => void })
{
  const [chosen, setChosen] = useState(JSON.stringify(['generation', profile.defaultModel])),
    [api, setApi] = useState<LlmApi>(profile.api);

  const choices = [...profile.models.filter(model => model.enabled).map(model => ({ kind: 'generation' as const, id: model.id, label: (model.name || model.id) + ' · 生成' })), ...(profile.embedding?.models ?? []).filter(model => model.enabled).map(model => ({ kind: 'embedding' as const, id: model.id, label: (model.name || model.id) + ' · 向量' }))];

  const value = choices.find(item => JSON.stringify([item.kind, item.id]) === chosen) ?? choices[0];

  const connection = value?.kind === 'embedding' ? profile.embedding : value ? selectProviderConnection(profile, { supportedApis: [api], fallbackApi: api }, value.id) : undefined;

  return <div><div className="model-actions"><FieldLabel>测试模型<Select aria-label={profile.name + ' 测试模型'} disabled={busy} value={value ? JSON.stringify([value.kind, value.id]) : ''} onChange={event => setChosen(event.target.value)}>{choices.map(item => <Option key={item.kind + item.id} value={JSON.stringify([item.kind, item.id])}>{item.label}</Option>)}</Select></FieldLabel>
    {value?.kind === 'generation' && <FieldLabel>测试接口<Select aria-label={profile.name + ' 测试接口'} value={api} disabled={busy} onChange={event => setApi(event.target.value as LlmApi)}>{llmApiSchema.options.map(protocol => <Option key={protocol} value={protocol} disabled={!selectProviderConnection(profile, { supportedApis: [protocol], fallbackApi: protocol }, value.id)}>{labels[protocol]}</Option>)}</Select></FieldLabel>}
    <Button disabled={busy || !value || !connection} onClick={() => value && onTest(value.kind === 'embedding' ? { kind: 'embedding', modelId: value.id } : { kind: 'generation', modelId: value.id, api })}>测试连接</Button></div><p className="inline-note">{connection ? connection.baseUrl + ' · ' + labels[connection.api] + '（使用已保存配置；仅发送小样本请求）' : '当前模型没有兼容接口，请编辑供应商配置。'}</p></div>;
}

/** 回执说明实际接口与有限验证范围，不表示完整任务或工具能力已验证。 */
export function connectionTestNotice(name: string, result: ModelActionResults['models.testConnection']): string
{
  return name + ' · ' + result.model + ' 连接成功 · ' + result.latencyMs + ' ms · ' + result.baseUrl + '（' + labels[result.api] + '，' + (result.api === 'openai-embeddings' ? '向量维度 ' + result.dimensions : '仅文本请求') + '）';
}
