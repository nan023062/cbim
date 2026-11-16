/**
 * 作用定位：窗口级操作说明、可聚焦和可悬停的 Tooltip；只读取已渲染控件的说明。
 * 设计原因：保留各业务按钮的标题与权限，统一延迟、边缘避让和关闭行为；触屏通过显式说明页查看相同信息。
 * 职责边界：不派发动作、不查询业务、不修改任务状态；卸载释放监听、计时器并恢复原生 title。
 */
import { useEffect, useId, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { Icon } from './Icon';

const selector = 'button[title],button[aria-label],a[title],summary[title],[data-help]';

/** 只使用作者提供的说明，避免从输入值或凭据字段推导帮助。 */
function description(element: HTMLElement): string
{
  return element.dataset.help || element.getAttribute('title') || element.getAttribute('aria-label') || '';
}
export function InterfaceHelp()
{
  const id = useId();

  const dialog = useRef<HTMLDialogElement>(null);

  const trigger = useRef<HTMLButtonElement>(null);

  const owner = useRef<HTMLElement | null>(null);

  const tipElement = useRef<HTMLDivElement>(null);

  const [tip, setTip] = useState<
    {
      text: string;

      x: number;

      y: number
    } | null>(null);

  const [help, setHelp] = useState<string[]>([]);

  const dismiss = useRef<() => void>(() => { });

  useEffect(() =>
  {
    let enter: ReturnType<typeof setTimeout> | undefined;

    let leave: ReturnType<typeof setTimeout> | undefined;

    let originalTitle: string | null = null;

    let originalDescription: string | null = null;

    const clear = () => { clearTimeout(enter); clearTimeout(leave) };

    const hide = () =>
    {
      clear();

      const element = owner.current;

      if (element)
      {
        // 仅撤销自己的描述，不覆盖业务或其它提示在此期间设置的新值。
        if (element.getAttribute('aria-describedby') === id)
        {
          if (originalDescription === null)

            element.removeAttribute('aria-describedby');

          else

            element.setAttribute('aria-describedby', originalDescription);
        }
        if (originalTitle !== null && !element.hasAttribute('title'))

          element.setAttribute('title', originalTitle);
      }
      owner.current = null;

      setTip(null);
    };
    dismiss.current = hide;

    const show = (element: HTMLElement) => { if (!element.isConnected || dialog.current?.open || element.closest('[hidden],[inert]')) return; const text = description(element); if (!text || element.getAttribute('aria-describedby')) return; originalTitle = element.getAttribute('title'); originalDescription = element.getAttribute('aria-describedby'); owner.current = element; element.removeAttribute('title'); element.setAttribute('aria-describedby', id); const bounds = element.getBoundingClientRect(); setTip({ text, x: Math.max(8, Math.min(bounds.left, window.innerWidth - 328)), y: bounds.bottom + 8 }); };

    const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;

    const insideTip = (target: EventTarget | null) => target instanceof Node && !!tipElement.current?.contains(target);

    const over = (event: PointerEvent) => { if (event.pointerType === 'touch') return; if (insideTip(event.target)) { clearTimeout(leave); return } const element = target(event); if (element && element === owner.current) { clearTimeout(leave); return } hide(); if (element) enter = setTimeout(() => show(element), 450); };

    const out = (event: PointerEvent) => { if (event.relatedTarget instanceof Node && (owner.current?.contains(event.relatedTarget) || insideTip(event.relatedTarget))) return; clearTimeout(enter); leave = setTimeout(hide, 120); };

    const focus = (event: FocusEvent) => { hide(); const element = target(event); if (element) show(element) };

    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && owner.current) { hide(); event.preventDefault(); event.stopImmediatePropagation() } };

    const observer = new MutationObserver(records => { const element = owner.current; if (!element) return; const changed = records.some(record => element.contains(record.target) && (record.type === 'childList' || record.attributeName !== 'title' || element.hasAttribute('title'))); if (changed || !element.isConnected || element.closest('[hidden],[inert]') || !element.getClientRects().length) hide(); });

    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-label', 'aria-disabled', 'data-help', 'title', 'disabled'] });

    document.addEventListener('pointerover', over);

    document.addEventListener('pointerout', out);

    document.addEventListener('focusin', focus);

    document.addEventListener('focusout', hide);

    document.addEventListener('keydown', key, true);

    document.addEventListener('scroll', hide, true);

    window.addEventListener('resize', hide);

    return () => { hide(); observer.disconnect(); document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide); document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [id]);

  // 内容高度在渲染后核对，长说明也不会越过窗口底部。
  useEffect(() => { if (!tip || !tipElement.current) return; const bounds = tipElement.current.getBoundingClientRect(); const y = Math.max(8, window.innerHeight - bounds.height - 8); if (bounds.bottom > window.innerHeight - 8 && y !== tip.y) setTip({ ...tip, y }); }, [tip]);

  function openHelp()
  {
    dismiss.current();

    const descriptions = [...document.querySelectorAll<HTMLElement>(selector)]

      .filter(element => !element.closest('[hidden],[inert],dialog') && element.getClientRects().length && element !== trigger.current)

      .map(description).filter(Boolean);

    setHelp([...new Set(descriptions)]);

    dialog.current?.showModal();
  }
  /** 显式关闭和 Escape 共用焦点返回，不依赖后台窗口延迟派发原生 close 事件。 */
  function closeHelp()
  {
    dialog.current?.close();

    trigger.current?.focus();
  }
  return <>
    <button ref={trigger} className="interface-help-trigger" aria-label="查看当前页面操作说明" onClick={openHelp}><Icon name="info" size={16} /><span>操作说明</span></button>
    {tip && createPortal(<div ref={tipElement} id={id} role="tooltip" className="interface-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body)}
    <dialog ref={dialog} className="interface-help-dialog" aria-labelledby={`${id}-heading`} onCancel={event => { event.preventDefault(); closeHelp() }} onClose={() => trigger.current?.focus()}>
      <header><h2 id={`${id}-heading`}>当前页面操作说明</h2><button className="icon-button" aria-label="关闭操作说明" onClick={closeHelp}><Icon name="close" /></button></header>
      <p>说明仅介绍当前页面的操作。关闭后继续原来的工作。</p>
      {help.length ? <ul>{help.map(text => <li key={text}>{text}</li>)}</ul> : <p>当前页面的操作说明已直接显示在按钮和表单旁。</p>}
      <p>禁用的操作需要先满足页面中列出的条件；打开说明不会执行任何操作。</p>
    </dialog>
  </>;
}
