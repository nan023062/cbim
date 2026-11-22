/**
 * 作用定位：三栏布局统一管理两侧宽度和分隔线，中栏保留最小阅读空间。
 * 设计原因：两侧面板共享拖动与键盘交互约束。
 */
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import './ui.css';

type Side = 'left' | 'right';

type Divider =
  {
    side: Side;

    width: number;

    min: number;

    max: number;

    Change: (value?: number) => void
  };

const Panes = createContext<Record<Side, Divider> | null>(null);

export function ThreePaneLayout({ children, className, hidden, leftOpen, leftKey, rightKey }: { children: ReactNode; className: string; hidden?: boolean; leftOpen: boolean; leftKey: string; rightKey: string })
{
  const root = useRef<HTMLDivElement>(null);

  const [space, setSpace] = useState(window.innerWidth);

  const [saved, setSaved] = useState(() => ({ left: Number(localStorage.getItem(leftKey)), right: Number(localStorage.getItem(rightKey)) }));

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

        const key = side === 'left' ? leftKey : rightKey;

        setSaved(old => ({ ...old, [side]: n }));

        if (n)
          localStorage.setItem(key, String(n));
        else
          localStorage.removeItem(key);
      }
    };
  }

  return <Panes.Provider value={{ left: divider('left', left, 220, 420), right: divider('right', right, 280, rightMax) }}><div ref={root} className={'ui-three-pane ' + className} style={{ display: hidden ? 'none' : undefined, '--sidebar-width': left + 'px', '--right-pane-width': right + 'px' } as CSSProperties}>{children}</div></Panes.Provider>;
}

export function PaneDivider({ side, label, controls }: { side: Side; label: string; controls: string })
{
  const panes = useContext(Panes);

  const drag = useRef<
    {
      x: number;

      width: number
    } | undefined>(undefined);

  if (!panes)
    return null;

  const { width, min, max, Change } = panes[side];

  const sign = side === 'left' ? 1 : -1;

  return <div className="ui-pane-divider" data-side={side} role="separator" aria-orientation="vertical" aria-label={label} aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) Change(drag.current.width + sign * (e.clientX - drag.current.x)); }}
    onLostPointerCapture={() => { drag.current = undefined; }} onDoubleClick={() => Change()}
    onKeyDown={e => { if (e.key === 'Home') Change(); else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') Change(width + sign * (e.key === 'ArrowRight' ? 10 : -10)); else return; e.preventDefault(); }} />;
}
