/**
 * 作用定位：三栏布局统一管理两侧宽度和分隔线，中栏保留最小阅读空间。
 * 设计原因：两侧面板共享拖动与键盘交互约束。
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import '../../styles/ui.css';

import { Panes, type Side, type Divider } from './panes';

export function ThreePaneLayout({ children, className, hidden, leftOpen, widths: saved, onWidthChange }: { children: ReactNode; className: string; hidden?: boolean; leftOpen: boolean; widths: Readonly<Record<Side,number>>; onWidthChange(side:Side,width:number):void })
{
  const root = useRef<HTMLDivElement>(null);

  const [space, setSpace] = useState(window.innerWidth);


  useLayoutEffect(() => { const el = root.current!; const observer = new ResizeObserver(() => { if (el.clientWidth) setSpace(el.clientWidth); }); observer.observe(el); return () => observer.disconnect(); }, []);

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

  const left = clamp(saved.left || 320, 220, 420);

  const rightMax = Math.max(280, Math.min(900, space - (leftOpen ? left : 0) - 360));

  const right = clamp(saved.right || clamp(Math.round(space * .32), 310, 600), 280, rightMax);

  function divider(side: Side, width: number, min: number, max: number): Divider
  {
    return {
      side,

      width,

      min,

      max,

      Change(value)
      {
        const n = value === undefined ? 0 : clamp(value, min, max);

        onWidthChange(side,n);
      }
    };
  }

  return <Panes.Provider value={{ left: divider('left', left, 220, 420), right: divider('right', right, 280, rightMax) }}><div ref={root} className={'ui-three-pane ' + className} style={{ display: hidden ? 'none' : undefined, '--sidebar-width': left + 'px', '--right-pane-width': right + 'px' } as CSSProperties}>{children}</div></Panes.Provider>;
}
