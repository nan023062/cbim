/** 框架下拉浮层：使用真正打开菜单的按钮作为隐式锚点，支持输入补全等受控浮层。 */
import { ScrollWindow } from './ScrollWindow';
import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'span';
  anchorRef?: RefObject<HTMLElement | null>;
  matchWidth?: boolean;
  point?: { x: number; y: number };
  menuRef?: RefObject<HTMLDivElement | null>;
};

export function Popover({ as: Element = 'div', anchorRef, matchWidth, point, menuRef, style, ...props }: Props) {
  const local = useRef<HTMLDivElement>(null);
  const ref = menuRef ?? local;
  useLayoutEffect(() => {
    const menu = ref.current;
    const source = anchorRef?.current;
    if (!menu || !source) return;
    // Electron 支持带 source 的 showPopover；DOM 类型库尚未声明该参数。
    (menu.showPopover as (options: { source: HTMLElement }) => void)({ source });
    if (point) {
      const place = () => {
        const w = menu.offsetWidth, h = menu.offsetHeight;
        const right = point.x, left = point.x - w, down = point.y + 5, up = point.y - h - 5;
        const [x, y] = [[right, down], [left, down], [left, up], [right, up]].find(([x,y]) => x >= 0 && y >= 0 && x + w <= innerWidth && y + h <= innerHeight) ?? [right, down];
        menu.style.left = Math.max(0, Math.min(x, innerWidth - w)) + 'px';
        menu.style.top = Math.max(0, Math.min(y, innerHeight - h)) + 'px';
      };
      place();
      const observer = new ResizeObserver(place);
      observer.observe(menu);
      window.addEventListener('resize', place);
      return () => { observer.disconnect(); window.removeEventListener('resize', place); menu.hidePopover(); };
    }
    return () => menu.hidePopover();
  }, [anchorRef, point, ref]);
  return <Element {...ScrollWindow.native} {...props} ref={ref} popover={anchorRef ? 'manual' : 'auto'} style={{
    ...style, position: 'fixed', positionAnchor: 'auto', inset: 'auto', margin: point ? 0 : '5px 0',
    positionArea: point ? 'none' : 'bottom span-right',
    justifySelf: 'start', positionTryFallbacks: point ? 'none' : 'var(--ui-popup-fallbacks)',
    boxSizing: 'border-box', maxWidth: 'min(var(--popup-width, 100vw), calc(100vw - 10px))',
    maxHeight: 'min(var(--popover-height, 100dvh), calc(100dvh - 10px))', overflowY: 'auto',
    ...(matchWidth && { width: 'anchor-size(width)' }),
  }} />;
}
