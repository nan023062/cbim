/** 桌面原生滚动区域共用的交互控制；同一滑动窗内的横纵轴和嵌套内容共享可见期。 */
import { useEffect, useRef, type HTMLAttributes } from 'react';

/** 在每个渲染窗口安装一次，通过事件委托覆盖虚拟列表及动态挂载的弹窗。 */
export function mountScrollWindows(doc: Document)
{
  const win = doc.defaultView!;
  const listeners = new AbortController();
  const options = { capture: true, passive: true, signal: listeners.signal };
  const timers = new Map<HTMLElement, number>();
  const held = new Map<number, HTMLElement>();
  doc.documentElement.dataset.uiScrollWindows = '';

  function schedule(group: HTMLElement)
  {
    win.clearTimeout(timers.get(group));
    if ([...held.values()].includes(group)) return;
    timers.set(group, win.setTimeout(() => {
      delete group.dataset.uiScrollActive;
      timers.delete(group);
      group.dispatchEvent(new Event('ui-scroll-idle'));
    }, 3000));
  }

  function reveal(el: HTMLElement, pointer?: number)
  {
    const group = el.closest<HTMLElement>('[data-ui-scroll-window]') ?? el;
    if (pointer !== undefined) held.set(pointer, group);
    group.dataset.uiScrollActive = '';
    schedule(group);
  }

  function axes(el: HTMLElement)
  {
    const style = win.getComputedStyle(el);
    const native = (overflow: string) => /^(auto|scroll|overlay)$/.test(overflow) || el === doc.scrollingElement && overflow === 'visible';
    return { x: el.scrollWidth > el.clientWidth && native(style.overflowX), y: el.scrollHeight > el.clientHeight && native(style.overflowY) };
  }

  function revealNearest(target: EventTarget | null, x: boolean, y: boolean)
  {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (!(el instanceof HTMLElement)) continue;
      const axis = axes(el);
      if ((x && axis.x) || (y && axis.y)) { reveal(el); return; }
    }
  }

  doc.addEventListener('wheel', e => {
    if (!e.ctrlKey) revealNearest(e.target, !!e.deltaX || e.shiftKey && !!e.deltaY, !e.shiftKey && !!e.deltaY);
  }, options);
  doc.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof HTMLElement) || e.target.isContentEditable || e.target.closest('input,textarea,select,button')) return;
    revealNearest(e.target, ['ArrowLeft','ArrowRight'].includes(e.key), ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key));
  }, options);
  doc.addEventListener('pointerdown', e => {
    const el = e.target;
    if (e.button !== 0 || !(el instanceof HTMLElement)) return;
    const axis = axes(el);
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (axis.x && y >= el.clientTop + el.clientHeight || axis.y && (x < el.clientLeft || x >= el.clientLeft + el.clientWidth))
      reveal(el, e.pointerId);
  }, options);
  doc.addEventListener('touchmove', e => revealNearest(e.target, true, true), options);

  function release(id: number)
  {
    const group = held.get(id);
    if (!group) return;
    held.delete(id);
    schedule(group);
  }
  win.addEventListener('pointerup', e => release(e.pointerId), options);
  win.addEventListener('pointercancel', e => release(e.pointerId), options);
  win.addEventListener('blur', () => { for (const id of held.keys()) release(id); }, options);
  return () => {
    listeners.abort();
    for (const group of held.values()) delete group.dataset.uiScrollActive;
    for (const [group, timer] of timers) { win.clearTimeout(timer); delete group.dataset.uiScrollActive; }
    delete doc.documentElement.dataset.uiScrollWindows;
  };
}

/** 可滚动的布局容器，也是嵌套滚动区共用的计时范围。 */
export function ScrollWindow({ onIdle, className, ...props }: HTMLAttributes<HTMLDivElement> & { onIdle?: () => void })
{
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!onIdle || !el) return;
    el.addEventListener('ui-scroll-idle', onIdle);
    return () => el.removeEventListener('ui-scroll-idle', onIdle);
  }, [onIdle]);
  return <div {...props} ref={ref} {...ScrollWindow.native} className={['ui-scroll-window',className].filter(Boolean).join(' ')} />;
}

/** 语义元素和持有原生 ref 的控件直接声明计时范围，保留其 DOM 身份。 */
ScrollWindow.native = Object.freeze({ 'data-ui-scroll-window': '' });
