/**
 * 作用定位：团队页面的主 Agent 引擎/模型配置入口。
 * 设计原因：与对话栏共用设置服务；原生模态约束焦点，关闭前保护本地选择，固定 revision 防止覆盖另一入口的保存。
 */
import { Icon } from '../components/Icon';

import { useEffect, useState } from 'react';

import { ModalFrame } from '../components/ModalFrame';

import type { WorkspaceView } from '../../bridge/contracts/workspace';

import type { LlmSettings } from '../../bridge/contracts/models';

import type { AgentModelSelection } from '../../bridge/contracts/agent-settings';

import { EngineModelPicker } from '../components/EngineModelPicker';

import { useMainAgentSettings } from './useMainAgentSettings';

export function MainAgentEditor({ workspace, onClose }: { workspace: WorkspaceView; onClose: () => void })
{
  const settings = useMainAgentSettings(workspace.id, workspace.instanceId);

  const [models, setModels] = useState<LlmSettings>(),

    [selection, setSelection] = useState<AgentModelSelection | null>(null),

    [error, setError] = useState('');

  const [initial, setInitial] = useState<number>();

  const [changed, setChanged] = useState(false);

  function close()
  {
    if (!settings.busy && (!changed || confirm('放弃尚未保存的主 Agent 配置？')))

      onClose()
  }
  useEffect(() => { let cancelled = false; void window.cbim.call('models.list').then(value => { if (!cancelled) setModels(value) }).catch(cause => { if (!cancelled) setError(cause.message) }); return () => { cancelled = true } }, []);

  useEffect(() => { if (initial !== undefined || !settings.value || !models) return; setInitial(settings.value.revision); const profile = models.profiles.find(p => p.id === models.selectedId), model = profile?.models.find(m => m.enabled && m.id === profile.defaultModel); setSelection(settings.value.selection ?? (profile && model ? { engine: 'pi', profileId: profile.id, modelId: model.id } : null)); }, [settings.value, models, initial]);

  async function save()
  {
    if (!selection)
    {
      setError('请选择主 Agent 的引擎和模型');

      return
    }
    if (await settings.save(selection, initial))

      onClose();
  }
  return <ModalFrame label="主 Agent 配置" onRequestClose={close}><form className="modal architecture-editor" onSubmit={event => { event.preventDefault(); void save() }}>
    <header><h2>主 Agent 配置</h2><button type="button" disabled={settings.busy} onClick={close}><Icon name="close" size={16} />关闭</button></header>
    <p>与对话栏修改的是同一份主 Agent 配置，适用于本工作区的新执行。已启动和已排队的任务保留原选型。</p>
    <fieldset disabled={settings.busy || initial === undefined}><EngineModelPicker models={models} value={selection} required emptyLabel="请选择引擎" onChange={value => { setSelection(value); setChanged(true); setError('') }} /></fieldset>
    {(error || settings.error) && <p role="alert">{error || settings.error}</p>}
    {settings.value && initial !== undefined && settings.value.revision !== initial && <p role="alert">配置已从其他入口更新，请关闭后重新打开。</p>}
    <button type="submit" disabled={settings.busy || initial === undefined || settings.value?.revision !== initial}><Icon name="confirm" size={16} />保存主 Agent 配置</button>
  </form></ModalFrame>;
}
