/**
 * 作用定位：指令队列展示：拖柄支持鼠标和触屏；键盘与图标操作共用宿主版本化命令。
 * 设计原因：拖拽状态只属于交互过程，最终顺序和立即插入由宿主版本化队列命令裁定。
 */
import { useId, useRef, useState } from 'react';

import type { OfficeQueueSnapshot, OfficeQueueAction, OfficeQueueItem } from '../../bridge/contracts/discovery';

import { Icon } from '../../framework-ui';

export function OfficeQueuePanel({ snapshot, busy, OnChange, OnAnalyze }: { snapshot: OfficeQueueSnapshot; busy: boolean; OnChange(action: OfficeQueueAction): Promise<boolean>; OnAnalyze?(item: OfficeQueueItem): Promise<void> })
{
  const menuPrefix = useId();

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

  return <section className="office-queue" aria-label="待执行指令队列"><header><small>{snapshot.paused ? '队列已暂停' : '按顺序发送'}</small><button type="button" disabled={busy} title={snapshot.paused ? '继续队列' : '暂停队列'} aria-label={snapshot.paused ? '继续队列' : '暂停队列'} onClick={() => void OnChange({ action: snapshot.paused ? 'resume' : 'pause' })}><Icon name={snapshot.paused ? 'play' : 'pause'} size={16} /></button></header>
    <div ref={list} role="list" className="office-queue-list">{items.map((item, index) =>
    {
      const attempt = snapshot.attempts?.filter(record => record.itemId === item.id).at(-1);

      const last = attempt?.events.at(-1);

      const editable = !busy && item.status === 'queued';

      const source = item.cancelSource ?? (item.status === 'failed' && /^AbortError(?:$|:)/.test(item.error ?? '') ? 'unknown' : undefined);

      return <div role="listitem" data-queue-id={item.id} key={item.id} className={'office-queued-item' + (over === item.id ? ' queue-before' : '')}><div className="office-queued-row">
      <button type="button" className="office-queue-grip" disabled={!editable} aria-label={'拖动第 ' + (index + 1) + ' 条指令排序'} title="拖动排序 · Alt+↑/↓" onKeyDown={event => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); Move(item.id, event.key === 'ArrowUp' ? -1 : 1); } }} onPointerDown={event => { if (event.button !== 0) return; drag.current = { id: item.id, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const current = drag.current; if (!current) return; if (Math.abs(event.clientY - current.y) > 6) current.moved = true; if (!current.moved) return; const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-queue-id]'); if (hit && queued.some(entry => entry.id === hit.dataset.queueId)) { const at = queued.findIndex(entry => entry.id === hit.dataset.queueId); current.beforeId = event.clientY < hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2 ? queued[at].id : queued[at + 1]?.id; setOver(current.beforeId ?? 'end'); } const bounds = list.current?.getBoundingClientRect(); if (bounds && event.clientY > bounds.bottom - 20) list.current?.scrollBy(0, 12); if (bounds && event.clientY < bounds.top + 20) list.current?.scrollBy(0, -12); }} onPointerUp={event => { const current = drag.current; drag.current = undefined; setOver(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current?.moved && current.id !== current.beforeId) void OnChange({ action: 'move', revision: snapshot.revision, id: current.id, beforeId: current.beforeId }); }} onPointerCancel={() => { drag.current = undefined; setOver(undefined); }}><Icon name="grip" size={16} /></button>
      <div className="office-queued-copy"><p>{item.text}</p></div>
      <div className="office-queued-status"><button type="button" popoverTarget={menuPrefix + item.id} aria-label={'第 ' + (index + 1) + ' 条指令操作'} title={item.configuration.model?.engine + ' · ' + item.configuration.model?.modelId} onClick={event => { const menu = document.getElementById(menuPrefix + item.id); if (!menu) return; const rect = event.currentTarget.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(window.innerWidth - 188, rect.right - 180)) + 'px'; menu.style.top = Math.max(8, Math.min(window.innerHeight - 250, rect.bottom + 4)) + 'px'; }}><Icon name="enqueue" size={13} />{item.status === 'queued' ? '排队中' : item.status === 'inserted' ? '已插话' : item.status === 'inserting' ? '正在插话…' : item.status === 'failed' ? (source ? '执行已中止' : '执行失败') : '待确认'}<Icon name="chevronDown" size={12} /></button></div>
      <div id={menuPrefix + item.id} popover="auto" className="office-queue-menu" onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) event.currentTarget.hidePopover(); }}>
        <button type="button" disabled={!editable} title={snapshot.running ? '插入当前任务，沿用当前任务配置' : '优先执行这条指令，然后继续队列'} onClick={() => void OnChange({ action: snapshot.running ? 'insert' : 'start', revision: snapshot.revision, id: item.id })}><Icon name={snapshot.running ? 'up' : 'play'} size={16} />{snapshot.running ? '插话' : '立即执行'}</button>
        <button type="button" disabled={!editable} onClick={() => setEditing({ id: item.id, text: item.text })}><Icon name="edit" size={16} />编辑</button>
        <button type="button" disabled={!editable || queued[0]?.id === item.id} onClick={() => Move(item.id, -1)}><Icon name="up" size={16} />提前一位</button>
        <button type="button" disabled={busy || ['inserted', 'inserting'].includes(item.status)} onClick={() => void OnChange({ action: 'remove', revision: snapshot.revision, id: item.id })}><Icon name="remove" size={16} />取消发送</button>
        {['failed', 'uncertain'].includes(item.status) && <button type="button" disabled={busy} title="核实上次结果后按原配置重试" onClick={() => void OnChange({ action: 'retry', revision: snapshot.revision, id: item.id })}><Icon name="retry" size={16} />重试</button>}
      </div>
      {item.error && last && attempt && <small>最后记录：{last.stage}{attempt.ended != null && ' · 本阶段 ' + ((attempt.ended - last.at) / 1000).toFixed(1) + ' 秒 · 本次共 ' + ((attempt.ended - attempt.started) / 1000).toFixed(1) + ' 秒'}{attempt.timeoutMs && ' · 超时上限 ' + attempt.timeoutMs / 1000 + ' 秒'}</small>}
      {item.error && <small role="alert" title={item.error}>{source ? '取消来源：' + ({ 'user-stop': '用户停止', 'app-shutdown': '应用关闭', unknown: '未知' })[source] : item.error}</small>}
      {['failed', 'uncertain'].includes(item.status) && <div className="office-error-actions"><button type="button" disabled={busy} onClick={() => void OnChange({ action: 'retry', revision: snapshot.revision, id: item.id })}><Icon name="retry" size={14} />重试</button>{OnAnalyze && <button type="button" disabled={busy} onClick={() => void OnAnalyze(item)}><Icon name="inspect" size={14} />分析</button>}</div>}
    </div>{editing?.id === item.id && <div className="office-queue-editor"><textarea autoFocus aria-label="编辑排队指令" maxLength={32000} disabled={busy} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} /><small>保留提交时的引擎、模型、连接器与权限</small><button type="button" disabled={busy || !editing.text.trim()} title="保存编辑" aria-label="保存编辑" onClick={() => void OnChange({ action: 'edit', revision: snapshot.revision, id: item.id, text: editing.text }).then(ok => { if (ok) setEditing(undefined); })}><Icon name="confirm" size={16} /></button><button type="button" disabled={busy} title="取消编辑" aria-label="取消编辑" onClick={() => setEditing(undefined)}><Icon name="close" size={16} /></button></div>}</div>;
    })}<div className={over === 'end' ? 'queue-before' : ''} /></div>
  </section>;
}
