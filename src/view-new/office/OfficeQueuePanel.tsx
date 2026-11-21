/** 指令队列展示：拖柄支持鼠标和触屏；键盘与图标操作共用宿主版本化命令。 */
import { useRef, useState } from 'react';

import type { OfficeQueueSnapshot, OfficeQueueAction } from '../../bridge/contracts/discovery';

import { Icon } from '../shared/Icon';

export function OfficeQueuePanel({ snapshot, busy, OnChange }: { snapshot: OfficeQueueSnapshot; busy: boolean; OnChange(action: OfficeQueueAction): Promise<boolean> })
{
  const [editing, setEditing] = useState<
    {
      id: string;

      text: string
    }>();

  const [over, setOver] = useState<string>();

  const drag = useRef<
    {
      id: string;

      y: number;

      moved: boolean;

      beforeId?: string
    } | undefined>(undefined);

  const list = useRef<HTMLDivElement>(null);

  const items = snapshot.items.filter(item => item.status !== 'running');

  const queued = items.filter(item => item.status === 'queued');

  function Move(id: string, direction: number)
  {
    const index = queued.findIndex(item => item.id === id);

    if (direction < 0 && index > 0 || direction > 0 && index < queued.length - 1)
      void OnChange({ action: 'move', revision: snapshot.revision, id, beforeId: queued[index + (direction < 0 ? -1 : 2)]?.id });
  }

  if (!items.length && !snapshot.paused)
    return null;

  return <section className="office-queue" aria-label="待执行指令队列"><header><strong>{snapshot.paused ? '队列已暂停' : '待执行'} · {queued.length}</strong><small>按提交顺序执行，可拖动调整</small><button type="button" disabled={busy} title={snapshot.paused ? '继续队列' : '暂停队列'} aria-label={snapshot.paused ? '继续队列' : '暂停队列'} onClick={() => void OnChange({ action: snapshot.paused ? 'resume' : 'pause' })}><Icon name={snapshot.paused ? 'play' : 'pause'} size={16} /></button></header>
    <div ref={list} role="list" className="office-queue-list">{items.map((item, index) =>
    {
      const editable = !busy && item.status === 'queued';

      return <div role="listitem" data-queue-id={item.id} key={item.id} className={'office-queued-item' + (over === item.id ? ' queue-before' : '')}><div className="office-queued-row">
      <button type="button" className="office-queue-grip" disabled={!editable} aria-label={'拖动第 ' + (index + 1) + ' 条指令排序'} title="拖动排序 · Alt+↑/↓" onKeyDown={event => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); Move(item.id, event.key === 'ArrowUp' ? -1 : 1); } }} onPointerDown={event => { if (event.button !== 0) return; drag.current = { id: item.id, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const current = drag.current; if (!current) return; if (Math.abs(event.clientY - current.y) > 6) current.moved = true; if (!current.moved) return; const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-queue-id]'); if (hit && queued.some(entry => entry.id === hit.dataset.queueId)) { const at = queued.findIndex(entry => entry.id === hit.dataset.queueId); current.beforeId = event.clientY < hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2 ? queued[at].id : queued[at + 1]?.id; setOver(current.beforeId ?? 'end'); } const bounds = list.current?.getBoundingClientRect(); if (bounds && event.clientY > bounds.bottom - 20) list.current?.scrollBy(0, 12); if (bounds && event.clientY < bounds.top + 20) list.current?.scrollBy(0, -12); }} onPointerUp={event => { const current = drag.current; drag.current = undefined; setOver(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current?.moved && current.id !== current.beforeId) void OnChange({ action: 'move', revision: snapshot.revision, id: current.id, beforeId: current.beforeId }); }} onPointerCancel={() => { drag.current = undefined; setOver(undefined); }}><Icon name="grip" size={16} /></button>
      <div className="office-queued-copy"><p title={item.text}>{item.text}</p><small>{item.status === 'inserted' ? '已插入 · 沿用当前任务配置' : item.status === 'inserting' ? '正在插入…' : item.configuration.model?.engine + ' · ' + item.configuration.model?.modelId + ' · ' + (item.configuration.connectorIds?.length ?? 0) + ' 个连接器'}</small>{item.error && <small role="alert">{item.error}</small>}</div>
      <div className="office-queued-actions"><button type="button" disabled={!editable || !snapshot.running} title="立即插入当前任务；沿用当前任务的引擎、模型和连接器" aria-label={'立即插入第 ' + (index + 1) + ' 条指令'} onClick={() => void OnChange({ action: 'insert', revision: snapshot.revision, id: item.id })}><Icon name="enqueue" size={16} /></button><button type="button" disabled={!editable} title="编辑指令" aria-label={'编辑第 ' + (index + 1) + ' 条指令'} onClick={() => setEditing({ id: item.id, text: item.text })}><Icon name="edit" size={16} /></button><button type="button" disabled={busy || ['inserted', 'inserting'].includes(item.status)} title="移除指令" aria-label={'移除第 ' + (index + 1) + ' 条指令'} onClick={() => void OnChange({ action: 'remove', revision: snapshot.revision, id: item.id })}><Icon name="remove" size={16} /></button>
      {['failed', 'uncertain'].includes(item.status) && <button type="button" disabled={busy} title="核实上次结果后，按原配置重新执行" aria-label={'重新执行第 ' + (index + 1) + ' 条指令'} onClick={() => void OnChange({ action: 'retry', revision: snapshot.revision, id: item.id })}><Icon name="retry" size={16} /></button>}
      <button type="button" disabled={!editable || queued[0]?.id === item.id} title="向前移动" aria-label={'向前移动第 ' + (index + 1) + ' 条指令'} onClick={() => Move(item.id, -1)}><Icon name="up" size={16} /></button><button type="button" disabled={!editable || queued.at(-1)?.id === item.id} title="向后移动" aria-label={'向后移动第 ' + (index + 1) + ' 条指令'} onClick={() => Move(item.id, 1)}><Icon name="down" size={16} /></button></div>
    </div>{editing?.id === item.id && <div className="office-queue-editor"><textarea autoFocus aria-label="编辑排队指令" maxLength={32000} disabled={busy} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} /><small>保留提交时的引擎、模型、连接器与权限</small><button type="button" disabled={busy || !editing.text.trim()} title="保存编辑" aria-label="保存编辑" onClick={() => void OnChange({ action: 'edit', revision: snapshot.revision, id: item.id, text: editing.text }).then(ok => { if (ok) setEditing(undefined); })}><Icon name="confirm" size={16} /></button><button type="button" disabled={busy} title="取消编辑" aria-label="取消编辑" onClick={() => setEditing(undefined)}><Icon name="close" size={16} /></button></div>}</div>;
    })}<div className={over === 'end' ? 'queue-before' : ''} /></div>
  </section>;
}
