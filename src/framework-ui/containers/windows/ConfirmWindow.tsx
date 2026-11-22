/**
 * 作用定位：通用确认窗：调用方提供操作说明并负责提交结果；可配置操作文案、危险样式和初始焦点。
 * 设计原因：焦点和取消语义统一，业务写入由调用方决定。
 */
import { ScrollWindow } from '../ScrollWindow';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import './windows.css';

export function ConfirmWindow({ title, children, confirmLabel = '确认', cancelLabel = '取消', busyLabel = '正在处理…', danger = false, focusConfirm = false, busy = false, error, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel?: string; cancelLabel?: string; busyLabel?: string; danger?: boolean; focusConfirm?: boolean; busy?: boolean; error?: string; onCancel: () => void; onConfirm: () => void })
{
  const dialog = useRef<HTMLDialogElement>(null);

  const id = useId();

  useEffect(() => { const element = dialog.current!; element.showModal(); element.querySelector<HTMLButtonElement>('[data-initial-focus=true]:not(:disabled)')?.focus(); return () => element.close(); }, []);

  return <dialog {...ScrollWindow.native} className="ui-confirm-window" data-motion="panel" ref={dialog} aria-labelledby={id} aria-describedby={id + '-body'} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id={id}>{title}</h3><div id={id + '-body'}>{children}</div>{error && <p role="alert">{error}</p>}
    <footer><button type="button" data-danger={danger || undefined} data-initial-focus={focusConfirm} disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button><button type="button" data-initial-focus={!focusConfirm} disabled={busy} onClick={onCancel}>{cancelLabel}</button></footer>
  </dialog>;
}
